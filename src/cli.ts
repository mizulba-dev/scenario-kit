#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { APP_STEP_KEYS } from "./lib/app-steps";
import { assertFfmpegAvailable, convertToMp4, probeDimensions, probeDuration } from "./lib/ffmpeg";
import { loadConfig, type ScenarioKitConfig } from "./lib/config";
import { UserError } from "./lib/errors";
import { runInit } from "./lib/init";
import { runLogin } from "./lib/login";
import { runInstallSkill } from "./lib/install-skill";
import { assertDarwinPlatform, startMacRecording } from "./lib/mac-recorder";
import { startSmoke } from "./lib/smoke";
import { startRecording } from "./lib/recorder";
import { renderDemo } from "./lib/render";
import { loadScenario, type LoadedScenario } from "./lib/scenario-loader";
import { startShots } from "./lib/shots";
import { STEP_KEYS } from "./lib/steps";

const APP_SCENARIO_UNSUPPORTED_MESSAGE = "app scenarios are not supported by shots/smoke yet";

const HELP = `scenario-kit - record and render product demo videos from a JSON scenario

Usage:
  scenario-kit record <name>       Record a scenario to scenario-kit/out/recordings/<name>.webm
  scenario-kit render <name>       Convert + composite the recording into scenario-kit/out/<name>-demo.mp4
  scenario-kit run <name>          record + render
  scenario-kit shots <name>        Capture PNG screenshots to scenario-kit/out/shots/<name>/ (no video, no ffmpeg)
  scenario-kit smoke <name>        Record + detect runtime issues, writing scenario-kit/out/smoke/<name>/{video.mp4,report.json,*.png}
  scenario-kit login [url]         Open a browser to log in manually, then save the session (Playwright storageState) for logged-in recordings
  scenario-kit init                Scaffold scenario-kit/ (config.json + scenarios/landing.json) in the current project
  scenario-kit install-skill       Install the scenario-kit SKILL.md into .claude/skills/ and .agents/skills/
  scenario-kit install-skill --user  Install into ~/.claude/skills/scenario-kit/ instead

Looks for scenario-kit/config.json by searching upward from the current directory.

Steps vocabulary (scenario-kit/scenarios/<name>.json "steps" array, one key per step):
  { "goto": "https://example.com" }        navigate to a URL
  { "click": "text=Sign up" }              click a Playwright locator
  { "type": ["input[name=q]", "hi"] }      type text into a locator
  { "move": [720, 400] }                   move the mouse cursor
  { "scroll": 800 }                        smooth-scroll to a Y offset
  { "pause": 1000 }                        wait N milliseconds
  { "waitFor": ".hero" }                   wait for a locator to appear
  { "mark": "hero" }                       record a named timeline marker
  { "highlight": "text=Get started" }      draw a red highlight box around a locator (shots only)
  { "screenshot": "hero" }                 capture the current viewport as a PNG (shots/smoke only), then clear highlights
(known step keys: ${STEP_KEYS.join(", ")} - unknown keys are rejected before recording starts)

Example scenario-kit/scenarios/landing.json:
  {
    "$schema": "https://unpkg.com/scenario-kit/schema/scenario.schema.json",
    "steps": [
      { "goto": "https://example.com" },
      { "pause": 1000 },
      { "mark": "hero" }
    ]
  }

macOS app scenarios (record/render/run only - not shots/smoke):
Add a top-level "app" key naming a macOS app (as used by \`open -a\` / System
Events) to drive a desktop app instead of a browser. Requires macOS, ffmpeg,
and cliclick (\`brew install cliclick\`) on PATH, plus Accessibility
permission for your terminal (System Settings -> Privacy & Security ->
Accessibility) and, on first run, the screen-recording permission prompt.

  { "app": { "name": "Claude", "width": 1440, "height": 900 },  width/height optional, default 1440x900
    "steps": [ ... ] }

App steps vocabulary (independent from the web steps above):
  { "keystroke": "cmd+n" }                 modifiers (cmd/shift/ctrl/opt) joined with "+", then
                                            enter/esc/tab/space or a single alphanumeric key
  { "type": "hello" }                      type Unicode text into the focused element
  { "click": [x, y] }                      move (eased) then click a window-relative point (pt)
  { "move": [x, y] }                       move the cursor to a window-relative point (pt), no click
  { "pause": 1000 }                        wait N milliseconds
  { "mark": "reply" }                      record a named timeline marker
(known app step keys: ${APP_STEP_KEYS.join(", ")})

Example scenario-kit/scenarios/claude-desktop.json:
  {
    "app": { "name": "Claude", "width": 1440, "height": 900 },
    "steps": [
      { "keystroke": "cmd+n" },
      { "type": "こんにちは、今日の天気は？" },
      { "keystroke": "enter" },
      { "pause": 3000 },
      { "mark": "reply" }
    ]
  }
`;

// name はファイル探索・出力パスの組み立てにそのまま使われるため、scenario-kit/ 外への
// パストラバーサル（../foo、絶対パス）を防ぐには単一 path segment に限定する
const SCENARIO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const requireName = (args: string[]): string => {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const name = positionals[0];
  if (!name) {
    throw new UserError('scenario name is required, e.g. "scenario-kit run landing"');
  }
  if (!SCENARIO_NAME_RE.test(name)) {
    throw new UserError(
      `invalid scenario name "${name}": must match ${SCENARIO_NAME_RE} (letters, digits, "_", "-", no path separators)`,
    );
  }
  return name;
};

// record の中核ロジック。runRecord と runRun の両方から、それぞれが解決した同一の
// LoadedScenario を渡して呼ぶ（呼び出し側で loadScenario を2回呼ぶと、TS シナリオは
// tsImport のたびに新しい namespace でトップレベル副作用が再実行されうるため避ける）
const recordLoadedScenario = async (
  config: ScenarioKitConfig,
  name: string,
  loaded: LoadedScenario,
): Promise<{ videoPath: string }> => {
  const recordingsDir = join(config.outDir, "recordings");

  if (loaded.kind === "app") {
    const recording = await startMacRecording({
      dir: recordingsDir,
      name,
      app: loaded.app,
    });
    let videoPath: string;
    let stepsSucceeded = false;
    try {
      await recording.run(loaded.steps);
      stepsSucceeded = true;
    } finally {
      // steps 失敗時も必ず finish() で ffmpeg を止め録画を書き切る。stepsSucceeded を
      // 渡し、失敗時は finish() 内で meta を macapp へ切り替えさせない（旧 driver の
      // 録画を render が引き続き選べるようにする）。ffmpeg 自身が異常終了していた場合は
      // finish() 自体が UserError を投げ、その場合は下の rmSync に到達しない
      ({ videoPath } = await recording.finish({ stepsSucceeded }));
    }
    // 新録画が確定した後にだけ、反対 driver（web）の旧成果物を消す
    rmSync(join(recordingsDir, `${name}.webm`), { force: true });
    return { videoPath };
  }

  const { page, mark, finish } = await startRecording({
    dir: recordingsDir,
    name,
    storageState: config.storageState,
  });

  let videoPath: string;
  try {
    // 動画には擬似カーソルのみを映す。赤枠アノテーションは shots 専用なので record では no-op
    await loaded.scenario({ page, mark, highlight: async () => {}, screenshot: async () => {} });
  } finally {
    // scenario 失敗時も必ず finish() でブラウザを閉じる（Chromium リーク防止）
    ({ videoPath } = await finish());
  }
  // render が driver を一意に判定できるよう web も meta を書く（macapp と対称にする）
  writeFileSync(
    join(recordingsDir, `${name}-meta.json`),
    JSON.stringify({ driver: "web" }, null, 1),
  );
  // 新録画・meta の書き込みが確定した後にだけ、反対 driver（macapp）の旧成果物を消す
  rmSync(join(recordingsDir, `${name}.mp4`), { force: true });
  return { videoPath };
};

const runRecord = async (args: string[]): Promise<number> => {
  const name = requireName(args);
  const config = loadConfig();
  const loaded = await loadScenario(config.scenariosDir, name);
  const { videoPath } = await recordLoadedScenario(config, name, loaded);
  console.log(`recorded: ${videoPath}`);
  return 0;
};

const runShots = async (args: string[]): Promise<number> => {
  const name = requireName(args);
  const config = loadConfig();
  const loaded = await loadScenario(config.scenariosDir, name);
  if (loaded.kind === "app") {
    throw new UserError(APP_SCENARIO_UNSUPPORTED_MESSAGE);
  }

  const dir = join(config.outDir, "shots", name);
  const { page, highlight, screenshot, finish } = await startShots({
    dir,
    storageState: config.storageState,
  });

  try {
    // shots モードでは mark は no-op（events.json は出力しない）
    await loaded.scenario({ page, mark: () => {}, highlight, screenshot });
  } finally {
    await finish();
  }
  console.log(`shots: ${dir}`);
  return 0;
};

const runSmoke = async (args: string[]): Promise<number> => {
  const name = requireName(args);
  const config = loadConfig();
  const scenarioType: "json" | "ts" = existsSync(join(config.scenariosDir, `${name}.json`))
    ? "json"
    : "ts";
  const loaded = await loadScenario(config.scenariosDir, name);
  if (loaded.kind === "app") {
    // app シナリオの「未対応」判定（exit 1）を ffmpeg 不在チェック（exit 2）より先に行う
    throw new UserError(APP_SCENARIO_UNSUPPORTED_MESSAGE);
  }
  assertFfmpegAvailable();

  const dir = join(config.outDir, "smoke", name);
  const session = await startSmoke({ dir, name, storageState: config.storageState });

  let failureMessage: string | undefined;
  try {
    // 録画に写り込むため highlight は no-op（shots 専用、#139 と同じ理由）
    await loaded.scenario({
      page: session.page,
      mark: session.mark,
      highlight: async () => {},
      screenshot: session.screenshot,
      onStep: session.onStep,
    });
  } catch (err) {
    failureMessage = err instanceof Error ? err.message : String(err);
  }

  const { report, reportPath, videoPath } = await session.finish({ scenarioType, failureMessage });
  console.log(`smoke: ${videoPath}`);
  console.log(`report: ${reportPath}`);
  return report.ok ? 0 : 2;
};

// recordings/<name>-meta.json の driver で入力ファイルの種類を一意に決める（存在チェックの
// 優先順位に頼ると、driver 切り替え直後に残った旧ファイルを誤って拾いうる）。meta が無い・
// 壊れている場合だけ録画ファイルの存在から推定する: webm があれば macapp 導入前の web 録画
// （後方互換）、mp4 しか無ければ meta を失った macapp 録画として扱う
const readRecordingDriver = (recordingsDir: string, name: string): "web" | "macapp" => {
  const metaPath = join(recordingsDir, `${name}-meta.json`);
  if (existsSync(metaPath)) {
    try {
      const value: unknown = JSON.parse(readFileSync(metaPath, "utf8"));
      const driver =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).driver
          : undefined;
      return driver === "macapp" ? "macapp" : "web";
    } catch {
      // 壊れた meta はファイル存在からの推定へフォールバック
    }
  }
  if (
    !existsSync(join(recordingsDir, `${name}.webm`)) &&
    existsSync(join(recordingsDir, `${name}.mp4`))
  ) {
    return "macapp";
  }
  return "web";
};

const runRender = async (args: string[]): Promise<number> => {
  const name = requireName(args);
  assertFfmpegAvailable();
  const config = loadConfig();

  const recordingsDir = join(config.outDir, "recordings");
  const driver = readRecordingDriver(recordingsDir, name);
  const recording = join(recordingsDir, driver === "macapp" ? `${name}.mp4` : `${name}.webm`);
  if (!existsSync(recording)) {
    throw new UserError(
      `recording not found: ${recording} (run "scenario-kit record ${name}" first)`,
    );
  }
  const windowStyle: "browser" | "bare" = driver === "macapp" ? "bare" : "browser";

  const publicDir = join(config.outDir, "public");
  mkdirSync(publicDir, { recursive: true });
  const mp4 = join(publicDir, `${name}.mp4`);
  convertToMp4(recording, mp4);
  const durationSec = probeDuration(mp4);
  // ウィンドウ枠を録画のアスペクト比に合わせる（app シナリオは録画サイズが可変のため）
  const { width: videoWidth, height: videoHeight } = probeDimensions(mp4);

  // Remotion は publicDir 基準の staticFile しか参照できないため、ロゴをコピーして
  // brand.logo をファイルパスから staticFile 名に差し替える
  let brand = config.brand;
  if (brand.logo) {
    if (!existsSync(brand.logo)) {
      throw new UserError(
        `logo not found: ${brand.logo} ("brand.logo" in scenario-kit/config.json)`,
      );
    }
    const logoName = `logo${extname(brand.logo)}`;
    copyFileSync(brand.logo, join(publicDir, logoName));
    brand = { ...brand, logo: logoName };
  }

  const outFile = join(config.outDir, `${name}-demo.mp4`);
  await renderDemo({
    srcName: `${name}.mp4`,
    durationSec,
    brand,
    publicDir,
    outFile,
    intro: config.intro,
    outro: config.outro,
    windowStyle,
    videoWidth,
    videoHeight,
  });
  console.log(`rendered: ${outFile}`);
  return 0;
};

const runRun = async (args: string[]): Promise<number> => {
  const name = requireName(args);
  const config = loadConfig();
  const loaded = await loadScenario(config.scenariosDir, name);
  if (loaded.kind === "app") {
    // 非 macOS では「app シナリオ非対応」（exit 1）を ffmpeg 不在チェック（exit 2）より先に報告する
    assertDarwinPlatform();
  }
  // record 完了後に ffmpeg 未導入で失敗するのを避けるため、録画前に先んじて確認する
  assertFfmpegAvailable();
  const { videoPath } = await recordLoadedScenario(config, name, loaded);
  console.log(`recorded: ${videoPath}`);
  return runRender(args);
};

const main = async (): Promise<number> => {
  const [command, ...rest] = process.argv.slice(2);
  try {
    switch (command) {
      case "record":
        return await runRecord(rest);
      case "render":
        return await runRender(rest);
      case "run":
        return await runRun(rest);
      case "shots":
        return await runShots(rest);
      case "smoke":
        return await runSmoke(rest);
      // 配布済みの旧 SKILL.md が "qa" を叩いても壊れないための後方互換エイリアス
      case "qa":
        console.error(
          'note: "qa" was renamed to "smoke" (output now goes to scenario-kit/out/smoke/)',
        );
        return await runSmoke(rest);
      case "login": {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true });
        const config = loadConfig();
        const { path, usedDefaultPath } = await runLogin({
          dir: config.dir,
          storageState: config.storageState,
          url: positionals[0],
        });
        console.log(`saved: ${path}`);
        if (usedDefaultPath) {
          console.log(
            'add "storageState": ".auth/state.json" to scenario-kit/config.json to record with this session',
          );
        }
        return 0;
      }
      case "init": {
        const targetDir = runInit();
        console.log(`initialized: ${targetDir}`);
        return 0;
      }
      case "install-skill": {
        const { values } = parseArgs({ args: rest, options: { user: { type: "boolean" } } });
        for (const path of runInstallSkill({ user: values.user })) {
          console.log(`installed: ${path}`);
        }
        return 0;
      }
      case undefined:
        console.log(HELP);
        return 1;
      case "--help":
      case "-h":
      case "help":
        console.log(HELP);
        return 0;
      default:
        console.error(`unknown command: ${command}`);
        console.log(HELP);
        return 1;
    }
  } catch (err) {
    if (err instanceof UserError) {
      console.error(`error: ${err.message}`);
      return err.exitCode;
    }
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return 2;
  }
};

process.exitCode = await main();
