import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, AppStep } from "./app-steps";
import { KEYSTROKE_MODIFIERS, parseKeystroke } from "./app-steps";
import { UserError } from "./errors";
import { assertFfmpegAvailable } from "./ffmpeg";
import type { DemoEvent } from "./recorder";
import { FPS } from "./timing";

export interface MacRecorderOptions {
  dir: string;
  name: string;
  app: AppConfig;
}

export interface MacRecording {
  run: (steps: AppStep[]) => Promise<void>;
  // stepsSucceeded: run() が例外を投げずに完了したか。false のときは meta.json を書き換えず、
  // 直前まで有効だった録画（別 driver の旧録画など）を render が引き続き選べるようにする
  finish: (options: {
    stepsSucceeded: boolean;
  }) => Promise<{ videoPath: string; eventsPath: string; metaPath: string }>;
}

// ウィンドウを配置しにいく目標位置（メニューバー下・左上寄せ）。OS が最小サイズ制約や
// ノッチ等で補正することがあるため、crop・クリック座標には activateAndPositionWindow が
// 読み戻す実 rect を使う（この定数はあくまで position 指定の入力値）
export const WINDOW_ORIGIN_PT = { x: 0, y: 25 } as const;

// system_profiler / Finder 経由の scale 検出に失敗した場合のフォールバック（Retina 相当）
export const DEFAULT_DISPLAY_SCALE = 2;

const DEFAULT_SCREEN_DEVICE_INDEX = "1";

const FFMPEG_STOP_TIMEOUT_MS = 5000;

export interface CropRectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

// h264 は奇数解像度をエンコードできないため偶数px に丸める
const toEvenPx = (pt: number, scale: number): number => {
  const px = Math.round(pt * scale);
  return px % 2 === 0 ? px : px + 1;
};

export const computeCropRectPx = (
  window: { width: number; height: number },
  origin: { x: number; y: number },
  scale: number,
): CropRectPx => ({
  x: toEvenPx(origin.x, scale),
  y: toEvenPx(origin.y, scale),
  width: toEvenPx(window.width, scale),
  height: toEvenPx(window.height, scale),
});

// 純粋部分: 物理px幅 ÷ 論理pt幅（丸めない）。IO 部分の detectDisplayScale と分離し、
// 1.5 等の非整数 scale もテストで直接検証できるようにする（丸めると crop が実サイズを
// 超えたり不足したりする）
export const computeDisplayScale = (pixelWidth: number, logicalWidth: number): number =>
  pixelWidth / logicalWidth;

// AppleScript の "..." 文字列リテラルへ安全に埋め込むためのエスケープ。
// バックスラッシュ・二重引用符をエスケープし、構文を壊すリテラル改行は空白に置換する
export const escapeAppleScriptString = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, " ");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isOnPath = (bin: string, args: string[]): boolean => {
  try {
    execFileSync(bin, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

export const assertDarwinPlatform = (): void => {
  if (process.platform !== "darwin") {
    throw new UserError(
      `app scenarios require macOS (process.platform is ${JSON.stringify(process.platform)})`,
    );
  }
};

export const assertCliclickAvailable = (): void => {
  if (!isOnPath("cliclick", ["-V"])) {
    throw new UserError(
      'cliclick not found on PATH. Install it — e.g. "brew install cliclick" on macOS — then retry.',
      2,
    );
  }
};

// プロセス名の問い合わせだけではアクセシビリティ権限が無くても成功しうるため、
// 権限そのものを表す "UI elements enabled" プロパティで判定する
export const preflightAccessibility = (): void => {
  const hint =
    "macOS Accessibility permission is required to drive the app via System Events. Grant it in System Settings → Privacy & Security → Accessibility (allow your terminal app), then retry.";
  let output: string;
  try {
    output = execFileSync(
      "osascript",
      ["-e", 'tell application "System Events" to UI elements enabled'],
      { encoding: "utf8" },
    );
  } catch {
    throw new UserError(hint, 2);
  }
  if (output.trim() !== "true") {
    throw new UserError(hint, 2);
  }
};

// system_profiler の出力から主ディスプレイ（"Main Display: Yes" を持つブロック）の物理px幅を
// 取り出す。マルチモニタでは Resolution 行が複数並ぶため、Main Display マーカーの直前の
// Resolution 行がそのディスプレイのもの。マーカーが無い（1画面等）場合は最初の行を使う
export const parseMainDisplayPixelWidth = (profilerText: string): number | undefined => {
  const resolutions: { index: number; width: number }[] = [];
  for (const match of profilerText.matchAll(/Resolution:\s*(\d+)\s*x\s*\d+/g)) {
    resolutions.push({ index: match.index, width: Number.parseInt(match[1]!, 10) });
  }
  if (resolutions.length === 0) return undefined;
  const mainIndex = profilerText.indexOf("Main Display: Yes");
  if (mainIndex === -1) return resolutions[0]!.width;
  const before = resolutions.filter((r) => r.index < mainIndex);
  return (before.at(-1) ?? resolutions[0]!).width;
};

// 主ディスプレイ（原点＝メニューバーのある画面。ウィンドウ配置先・ffmpeg の Capture screen と
// 同じ画面）の論理pt幅と system_profiler の解像度（物理px）から実効スケールを算出する。
// Finder の desktop bounds は全ディスプレイ合算の矩形を返しマルチモニタで破綻するため、
// NSScreen.screens の先頭（＝主ディスプレイ）を使う。検出できない場合は DEFAULT_DISPLAY_SCALE
const detectDisplayScale = (): number => {
  try {
    const output = execFileSync(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        'ObjC.import("AppKit"); $.NSScreen.screens.js[0].frame.size.width',
      ],
      { encoding: "utf8" },
    );
    const logicalWidth = Number.parseFloat(output.trim());

    const profiler = execFileSync("system_profiler", ["SPDisplaysDataType"], { encoding: "utf8" });
    const pixelWidth = parseMainDisplayPixelWidth(profiler);

    if (Number.isFinite(logicalWidth) && logicalWidth > 0 && pixelWidth !== undefined) {
      return computeDisplayScale(pixelWidth, logicalWidth);
    }
  } catch {
    // 検出失敗時はフォールバックへ
  }
  return DEFAULT_DISPLAY_SCALE;
};

// ffmpeg avfoundation の "Capture screen N" デバイス index を検出する。
// -list_devices は必ず非0終了するため、stderr をエラーオブジェクトから読む
const detectScreenDeviceIndex = (): string => {
  try {
    execFileSync("ffmpeg", ["-f", "avfoundation", "-list_devices", "true", "-i", ""]);
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const text = typeof stderr === "string" ? stderr : (stderr?.toString() ?? "");
    const match = text.match(/\[(\d+)]\s+Capture screen/);
    if (match) return match[1]!;
  }
  return DEFAULT_SCREEN_DEVICE_INDEX;
};

interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOW_WAIT_TIMEOUT_MS = 10000;
const WINDOW_WAIT_INTERVAL_MS = 500;

// コールドスタートの重いアプリは起動からウィンドウ出現まで数秒かかることがあるため、
// 固定待ちではなくウィンドウが現れるまでポーリングする
const waitForAppWindow = async (appName: string, escapedName: string): Promise<void> => {
  const deadline = Date.now() + WINDOW_WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      const output = execFileSync(
        "osascript",
        ["-e", `tell application "System Events" to count windows of process "${escapedName}"`],
        { encoding: "utf8" },
      );
      if (Number.parseInt(output.trim(), 10) > 0) return;
    } catch {
      // 起動直後はプロセス自体がまだ見えないことがある
    }
    if (Date.now() >= deadline) {
      throw new UserError(
        `no window of ${JSON.stringify(appName)} appeared within ${WINDOW_WAIT_TIMEOUT_MS / 1000}s after launch. Make sure the app opens a window on launch, then retry.`,
        2,
      );
    }
    await sleep(WINDOW_WAIT_INTERVAL_MS);
  }
};

const activateAndPositionWindow = async (app: AppConfig): Promise<WindowRect> => {
  try {
    execFileSync("open", ["-a", app.name], { stdio: "ignore" });
  } catch {
    throw new UserError(
      `app not found: ${JSON.stringify(app.name)} ("app.name" in the scenario must be a macOS application name usable with "open -a")`,
    );
  }
  const escapedName = escapeAppleScriptString(app.name);
  await waitForAppWindow(app.name, escapedName);
  const script = `
    tell application "System Events"
      tell process "${escapedName}"
        set frontmost to true
        tell window 1
          set position to {${WINDOW_ORIGIN_PT.x}, ${WINDOW_ORIGIN_PT.y}}
          set size to {${app.width}, ${app.height}}
          set thePosition to position
          set theSize to size
        end tell
      end tell
    end tell
    return ((item 1 of thePosition) as string) & "," & ((item 2 of thePosition) as string) & "," & ((item 1 of theSize) as string) & "," & ((item 2 of theSize) as string)
  `;
  // OS が最小サイズ制約・ノッチ等で位置/サイズを補正することがあるため、指定値ではなく
  // 実際に反映された rect を読み戻し、それを crop・クリック座標の基準にする
  const output = execFileSync("osascript", ["-e", script], { encoding: "utf8" });
  const parts = output
    .trim()
    .split(",")
    .map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new UserError(
      `failed to read back the window geometry from System Events: ${JSON.stringify(output)}`,
      2,
    );
  }
  const [x, y, width, height] = parts;
  return { x: x!, y: y!, width: width!, height: height! };
};

const KEY_CODES: Record<string, number> = { enter: 36, esc: 53, tab: 48, space: 49 };
const MODIFIER_AS: Record<(typeof KEYSTROKE_MODIFIERS)[number], string> = {
  cmd: "command down",
  shift: "shift down",
  ctrl: "control down",
  opt: "option down",
};

const runKeystroke = (stroke: string): void => {
  const parsed = parseKeystroke(stroke, "keystroke");
  const modifierClause =
    parsed.modifiers.length > 0
      ? ` using {${parsed.modifiers.map((m) => MODIFIER_AS[m]).join(", ")}}`
      : "";
  const keyCode = KEY_CODES[parsed.key];
  // parsed.key は parseKeystroke の正規表現で英数字1文字のみに限定済みなのでエスケープ不要
  const script =
    keyCode !== undefined
      ? `tell application "System Events" to key code ${keyCode}${modifierClause}`
      : `tell application "System Events" to keystroke "${parsed.key}"${modifierClause}`;
  execFileSync("osascript", ["-e", script]);
};

// JIS キーボードの「英数」キーの仮想キーコード。IME のライブ変換中にペーストすると
// 未確定状態のまま化けることがあるため、ペースト前に英数へ固定する保険として送る
// （JIS 以外のキーボードでは対応するキーが無く無視されるだけで害はない）
const KVK_JIS_EISU = 102;

// Cmd+V 送出後、対象アプリがペーストを反映しきるまでの待ち時間。TYPE_KEY_DELAY_MS
// （1字ずつのタイプ感用、30ms）とは別軸で、後続ステップが同じ入力欄を操作する前に
// ペーストが反映されているための猶予
const CLIPBOARD_PASTE_SETTLE_MS = 400;

// クリップボードが読めない場合は undefined（復元スキップ）。pbpaste は非テキスト（画像等）でも
// exit 0 + 空出力になるため、空も undefined に倒す（空文字を「復元」すると画像等を消してしまう）
const readClipboard = (): string | undefined => {
  try {
    const text = execFileSync("pbpaste", [], { encoding: "utf8" });
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
};

// cliclick の t: は ASCII のみで日本語等のマルチバイト文字を打てず、System Events の
// keystroke も1字ずつ IME を経由するため日本語がライブ変換で未確定のまま化ける（実機で確認済み）。
// クリップボード経由のペーストのみ確実に Unicode テキストを入力できるため、type はこの方式に一本化する。
// クリップボードの復元はここでは行わない: osascript の完了は Cmd+V イベントの投函までしか
// 保証せず、録画負荷下ではアプリ側の貼り付け処理が settle 待ちを超えて遅延しうるため、
// type 直後に復元すると復元後の旧内容が貼られるレースが起きる（実機で確認済み）。
// 退避・復元は録画セッション単位（初回 type で退避、finish() で復元）で行う
const runType = async (text: string): Promise<void> => {
  execFileSync("pbcopy", [], { input: text });
  try {
    execFileSync("osascript", [
      "-e",
      `tell application "System Events" to key code ${KVK_JIS_EISU}`,
    ]);
  } catch {
    // 保険のための送出なので失敗しても致命的ではない
  }
  execFileSync("osascript", [
    "-e",
    'tell application "System Events" to keystroke "v" using command down',
  ]);
  await sleep(CLIPBOARD_PASTE_SETTLE_MS);
};

const toScreenPoint = (
  origin: { x: number; y: number },
  [x, y]: [number, number],
): [number, number] => [origin.x + x, origin.y + y];

const runMove = (origin: { x: number; y: number }, point: [number, number]): void => {
  const [x, y] = toScreenPoint(origin, point);
  execFileSync("cliclick", ["-e", "80", `m:${x},${y}`]);
};

const runClick = (origin: { x: number; y: number }, point: [number, number]): void => {
  const [x, y] = toScreenPoint(origin, point);
  execFileSync("cliclick", ["-e", "80", `m:${x},${y}`, "c:."]);
};

interface FfmpegExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface FfmpegHandle {
  proc: ChildProcess;
  exited: Promise<FfmpegExit>;
}

const startFfmpeg = (options: {
  deviceIndex: string;
  crop: CropRectPx;
  outPath: string;
}): FfmpegHandle => {
  const { deviceIndex, crop, outPath } = options;
  const proc = spawn(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "avfoundation",
      "-capture_cursor",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      `${deviceIndex}:none`,
      "-vf",
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      outPath,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  // exit/error は一度きりしか発火しないため、finish() 側で後から .once するのではなく
  // 起動直後から購読して Promise に固定する（finish() 時点で既に発火済みだと
  // .once が二度と呼ばれずハングするのを防ぐ）
  const exited = new Promise<FfmpegExit>((resolve) => {
    proc.once("exit", (code, signal) => resolve({ code, signal }));
    proc.once("error", () => resolve({ code: null, signal: null }));
  });
  return { proc, exited };
};

// exited が既に解決していれば即座に、していなければ ms 経過で undefined を返す
const raceExitOrTimeout = async (
  exited: Promise<FfmpegExit>,
  ms: number,
): Promise<FfmpegExit | undefined> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  const result = await Promise.race([exited, timeout]);
  clearTimeout(timer!);
  return result;
};

// SIGINT で止めたときの ffmpeg の想定内な終了（正常終了 code 0、または SIGINT を自前で
// catch して exit(255) する ffmpeg の慣例）。この判定は「自分で止めた」ケースにのみ使う
export const isExpectedFfmpegStopExit = (result: FfmpegExit): boolean =>
  result.code === 0 || result.code === 255;

interface FfmpegStopResult {
  result: FfmpegExit;
  // false: finish() を呼ぶ前に ffmpeg が自発的に終了していた（録画中の異常終了）。
  // true: こちら側の SIGINT/SIGKILL 送信を契機に終了した
  selfInitiated: boolean;
}

const stopFfmpeg = async (
  proc: ChildProcess,
  exited: Promise<FfmpegExit>,
): Promise<FfmpegStopResult> => {
  // 既に終了済みなら、録画中に ffmpeg が自発的に落ちた（＝常に異常終了）ケース。
  // SIGINT を送らず、呼び出し元が exit code/signal を検査できるよう結果を返す
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return { result: await exited, selfInitiated: false };
  }
  // proc.kill() の戻り値は「シグナルが生存中のプロセスに実際に届いたか」を表す。この
  // 直前のチェックと kill() 呼び出しの間に ffmpeg が自発終了していた場合、kill() は
  // false を返す（シグナルは届いていない）ため、その終了を自己停止と誤認しない
  const sigintDelivered = proc.kill("SIGINT");
  if (!sigintDelivered) {
    return { result: await exited, selfInitiated: false };
  }
  const settled = await raceExitOrTimeout(exited, FFMPEG_STOP_TIMEOUT_MS);
  if (settled) {
    return { result: settled, selfInitiated: true };
  }
  // SIGINT に応答しない場合は SIGKILL で確実に終了させる（録画は不完全になりうるが
  // 自分で止めた結果なので、ハングで呼び出し元の finally 全体を止めるよりよい）
  const sigkillDelivered = proc.kill("SIGKILL");
  if (!sigkillDelivered) {
    return { result: await exited, selfInitiated: false };
  }
  return { result: await exited, selfInitiated: true };
};

export const startMacRecording = async (options: MacRecorderOptions): Promise<MacRecording> => {
  assertDarwinPlatform();
  assertFfmpegAvailable();
  assertCliclickAvailable();
  preflightAccessibility();

  const { dir, name, app } = options;
  mkdirSync(dir, { recursive: true });

  const windowRect = await activateAndPositionWindow(app);

  const scale = detectDisplayScale();
  const crop = computeCropRectPx(windowRect, windowRect, scale);
  const deviceIndex = detectScreenDeviceIndex();
  const videoPath = join(dir, `${name}.mp4`);
  // 最終パスへ直接録画すると、再録画が失敗したとき既存の有効な録画（meta が指したままの
  // mp4）を上書きで失う。一時パスへ録画し、steps 成功時にだけ rename で確定させる
  // （シナリオ名にドットは使えないため <name>.tmp が別シナリオ名と衝突することはない）
  const capturePath = join(dir, `${name}.tmp.mp4`);
  const { proc: ffmpeg, exited } = startFfmpeg({ deviceIndex, crop, outPath: capturePath });

  // avfoundation の初回フレーム確立を待つ間に ffmpeg が早期終了していないか確認する
  // （device index 不一致・crop が画面外・画面収録権限拒否等は起動直後に非0終了する）
  const earlyExit = await raceExitOrTimeout(exited, 500);
  if (earlyExit) {
    throw new UserError(
      `ffmpeg exited unexpectedly while starting the screen capture (code=${earlyExit.code}, signal=${earlyExit.signal}). Check the avfoundation device index and the screen-recording permission (System Settings → Privacy & Security → Screen Recording).`,
      2,
    );
  }

  const events: DemoEvent[] = [];

  // type を1つでも実行したセッションだけクリップボードを退避し finish() で復元する
  let clipboardTouched = false;
  let savedClipboard: string | undefined;

  const run = async (steps: AppStep[]): Promise<void> => {
    for (const step of steps) {
      if ("keystroke" in step) {
        runKeystroke(step.keystroke);
      } else if ("type" in step) {
        if (!clipboardTouched) {
          savedClipboard = readClipboard();
          clipboardTouched = true;
        }
        await runType(step.type);
      } else if ("click" in step) {
        runClick(windowRect, step.click);
        events.push({ t: Date.now(), type: "click", x: step.click[0], y: step.click[1] });
      } else if ("move" in step) {
        runMove(windowRect, step.move);
      } else if ("pause" in step) {
        await sleep(step.pause);
      } else {
        events.push({ t: Date.now(), type: "mark", label: step.mark });
      }
    }
  };

  return {
    run,
    finish: async ({ stepsSucceeded }) => {
      try {
        const { result, selfInitiated } = await stopFfmpeg(ffmpeg, exited);
        // SIGINT を送って自分で止めた結果が、ffmpeg 自身の正常終了（code 0）または
        // SIGINT を自前で catch した終了（exit 255）であることを要求する。SIGKILL への
        // 昇格は MP4 の終端情報（moov atom 等）が書き切れず破損しうるため成功扱いにしない
        const isAcceptable = selfInitiated && isExpectedFfmpegStopExit(result);
        if (!isAcceptable) {
          rmSync(capturePath, { force: true });
          throw new UserError(
            `ffmpeg exited unexpectedly during recording (code=${result.code}, signal=${result.signal}). The captured video may be missing or corrupted — check the screen-recording permission and available disk space, then retry.`,
            2,
          );
        }
        const eventsPath = join(dir, `${name}-events.json`);
        const metaPath = join(dir, `${name}-meta.json`);
        // steps 失敗時は成果物一式（動画・events・meta）に一切触れない。こうすると render は
        // 既存の録画（前回成功分や別 driver の録画）と整合した組を引き続き選べる
        if (stepsSucceeded) {
          renameSync(capturePath, videoPath);
          writeFileSync(eventsPath, JSON.stringify(events, null, 1));
          writeFileSync(metaPath, JSON.stringify({ driver: "macapp" }, null, 1));
        } else {
          rmSync(capturePath, { force: true });
        }
        return { videoPath, eventsPath, metaPath };
      } finally {
        if (clipboardTouched && savedClipboard !== undefined) {
          try {
            execFileSync("pbcopy", [], { input: savedClipboard });
          } catch {
            // 復元に失敗しても録画自体は成立しているので無視する
          }
        }
      }
    },
  };
};
