import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cursorInitScript } from "./cursor";
import { convertToMp4 } from "./ffmpeg";
import { shotFileName } from "./shots";
import type { Step } from "./steps";

export type IssueType = "console-error" | "page-error" | "http-error" | "request-failed";

export interface Issue {
  type: IssueType;
  message: string;
  pageUrl: string;
  stepIndex: number | null;
  mark: string | null;
  screenshot: string | null;
}

export interface Failure {
  stepIndex: number | null;
  message: string;
  url: string;
  screenshot: string | null;
}

export interface StepReportEntry {
  index: number;
  step: Step;
  status: "ok" | "failed";
}

export type SmokeStatus = "pass" | "fail" | "inconclusive";

export interface SmokeReport {
  name: string;
  ok: boolean;
  // pass=退行なし / fail=退行検知 / inconclusive=環境起因で評価不能。ok は pass のときのみ true
  status: SmokeStatus;
  // inconclusive のときだけ設定する評価不能の理由
  reason?: string;
  video: string;
  scenarioType: "json" | "ts";
  steps: StepReportEntry[];
  failure: Failure | null;
  issues: Issue[];
}

// response イベントの分類。console-error/page-error/request-failed は発生イベント
// そのものが常に issue になるため分類不要で、http-error だけが status × resourceType
// によるノイズ抑制フィルタを要する
export interface HttpResponseInfo {
  status: number;
  resourceType: string;
}

const HTTP_ERROR_RESOURCE_TYPES: ReadonlySet<string> = new Set(["document", "xhr", "fetch"]);

export const classifyIssue = (response: HttpResponseInfo): "http-error" | null =>
  response.status >= 400 && HTTP_ERROR_RESOURCE_TYPES.has(response.resourceType)
    ? "http-error"
    : null;

// 接続確立自体に失敗した navigation を表す Chromium エラーマーカーの固定リスト。
// `Timeout ... exceeded`（遅いアプリと落ちたサーバーを区別できない）は含めない
const CONNECTION_ERROR_MARKERS: readonly string[] = [
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_ADDRESS_UNREACHABLE",
  "net::ERR_CONNECTION_TIMED_OUT",
];

// Playwright の navigation 失敗メッセージの先頭に付く呼び出し元プレフィックス。goto の
// 失敗は `page.goto: net::ERR_... at <url>` 形式で始まる（TS シナリオが生の Page から
// frame 経由で navigate すると `frame.goto: ` になる）
const NAVIGATION_ERROR_PREFIXES: readonly string[] = ["page.goto: ", "frame.goto: "];

// navigation の失敗メッセージが接続クラスのエラーかを決定的に判定する。marker への単純な
// includes だと、locator timeout の Call log にセレクタ文字列として marker が写り込むと
// 誤検知するため、navigation 失敗の呼び出し元プレフィックス直後に marker が来る形に
// アンカーする。最初のページ評価が成立する前にこれが起きた場合だけ inconclusive に読み替える
export const isConnectionClassError = (message: string): boolean =>
  NAVIGATION_ERROR_PREFIXES.some((prefix) =>
    CONNECTION_ERROR_MARKERS.some((marker) => message.startsWith(`${prefix}${marker}`)),
  );

export const MAX_ISSUE_SHOTS_WITHOUT_STEP_INDEX = 10;

export interface IssueShotState {
  capturedStepIndices: ReadonlySet<number>;
  totalCaptured: number;
}

// step index が分かる場合は同一 step につき1枚まで、TS シナリオ等で step index が
// 取れない場合は総数 MAX_ISSUE_SHOTS_WITHOUT_STEP_INDEX 枚までに抑える
export const shouldCaptureIssueShot = (stepIndex: number | null, state: IssueShotState): boolean =>
  stepIndex === null
    ? state.totalCaptured < MAX_ISSUE_SHOTS_WITHOUT_STEP_INDEX
    : !state.capturedStepIndices.has(stepIndex);

export interface MutableIssueShotState {
  capturedStepIndices: Set<number>;
  totalCaptured: number;
}

// shouldCaptureIssueShot の判定と、予約（Set 追加・カウント加算）を同一の同期区間で
// 行う。判定と予約の間に await を挟むと、同一 step で連続発火する issue（例:
// request-failed の直後の page-error）がどちらも「まだ空いている」と読んでしまい
// 上限を超えて撮影するレースになる
export const reserveIssueShot = (
  stepIndex: number | null,
  state: MutableIssueShotState,
): boolean => {
  if (!shouldCaptureIssueShot(stepIndex, state)) return false;
  if (stepIndex !== null) state.capturedStepIndices.add(stepIndex);
  state.totalCaptured += 1;
  return true;
};

export interface BuildReportInput {
  name: string;
  video: string;
  scenarioType: "json" | "ts";
  steps: StepReportEntry[];
  failure: Failure | null;
  issues: Issue[];
  // 指定されると failure/issues の有無に関わらず status="inconclusive" を優先する
  inconclusiveReason?: string;
}

export const buildReport = (input: BuildReportInput): SmokeReport => {
  const status: SmokeStatus =
    input.inconclusiveReason !== undefined
      ? "inconclusive"
      : input.failure === null && input.issues.length === 0
        ? "pass"
        : "fail";
  return {
    name: input.name,
    ok: status === "pass",
    status,
    ...(input.inconclusiveReason !== undefined ? { reason: input.inconclusiveReason } : {}),
    video: input.video,
    scenarioType: input.scenarioType,
    steps: input.steps,
    failure: input.failure,
    issues: input.issues,
  };
};

// ブラウザ起動前のセットアップ失敗（ffmpeg 不在・ブラウザ/コンテキスト起動失敗）でも
// out ディレクトリを作り直して inconclusive の report.json を必ず残す。exit code だけで
// 理由が分からない状態を作らないための保証。reportPath を返す
export const writeSetupFailureReport = (
  dir: string,
  input: { name: string; scenarioType: "json" | "ts"; reason: string },
): string => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const report = buildReport({
    name: input.name,
    video: "",
    scenarioType: input.scenarioType,
    steps: [],
    failure: null,
    issues: [],
    inconclusiveReason: input.reason,
  });
  const reportPath = join(dir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 1));
  return reportPath;
};

export interface SmokeOptions {
  dir: string;
  name: string;
  viewport?: { width: number; height: number };
  locale?: string;
  storageState?: string;
}

export interface SmokeFinishInput {
  scenarioType: "json" | "ts";
  /** step 実行中に投げられた例外のメッセージ。未指定なら走行は正常完走とみなす */
  failureMessage?: string;
}

export interface SmokeFinishResult {
  report: SmokeReport;
  reportPath: string;
  videoPath: string;
}

export interface SmokeSession {
  page: Page;
  mark: (label: string) => void;
  screenshot: (label: string) => Promise<void>;
  onStep: (step: Step, index: number) => void;
  finish: (input: SmokeFinishInput) => Promise<SmokeFinishResult>;
}

// frame() は Service Worker 起源のリクエストなど frame が確立できないケースで例外を
// 投げることがあるため、URL 導出は必ずこのヘルパー越しに行い "" にフォールバックする
export const safeUrl = (getUrl: () => string): string => {
  try {
    return getUrl();
  } catch {
    return "";
  }
};

export const startSmoke = async (options: SmokeOptions): Promise<SmokeSession> => {
  const { dir, name } = options;
  const viewport = options.viewport ?? { width: 1440, height: 900 };
  // 前回実行の残骸が混ざらないよう、実行冒頭で出力ディレクトリを作り直す
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const browser: Browser = await chromium.launch();

  let context: BrowserContext;
  let page: Page;

  const stepsLedger: StepReportEntry[] = [];
  const issues: Issue[] = [];
  const pendingIssues: Promise<void>[] = [];
  const issueShotState: MutableIssueShotState = {
    capturedStepIndices: new Set(),
    totalCaptured: 0,
  };
  let issueSeq = 0;
  let currentStepIndex: number | null = null;
  let currentMark: string | null = null;
  let shotIndex = 0;
  // finish() 開始後に届くイベントを記録しないための受付停止フラグ
  let stopped = false;
  // 最初のページ評価が成立したか（実ページへの framenavigated コミット）。接続クラス失敗を
  // 「評価不能」に読み替えるのは、この成立が一度も起きていない場合に限る
  let evaluated = false;

  const addIssue = (type: IssueType, message: string, pageUrl: string): void => {
    if (stopped) return;
    const stepIndex = currentStepIndex;
    const markLabel = currentMark;

    const captured = reserveIssueShot(stepIndex, issueShotState);
    const issue: Issue = { type, message, pageUrl, stepIndex, mark: markLabel, screenshot: null };
    issues.push(issue);
    if (!captured) return;

    issueSeq += 1;
    const shotName = `issue-${issueSeq}.png`;
    pendingIssues.push(
      (async () => {
        try {
          await page.screenshot({ path: join(dir, shotName) });
          issue.screenshot = shotName;
        } catch {
          // ナビゲーション直後などで撮影できないことがある。issue 自体は記録を続ける
        }
      })(),
    );
  };

  try {
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      recordVideo: { dir, size: viewport },
      locale: options.locale ?? "ja-JP",
      storageState: options.storageState,
    });

    // context レベルに newPage() より前で登録し、最初のページの生成中（初期
    // document への addInitScript 実行を含む）に起きる issue も取りこぼさない
    context.on("console", (msg) => {
      if (msg.type() === "error") addIssue("console-error", msg.text(), msg.page()?.url() ?? "");
    });
    context.on("weberror", (webError) => {
      addIssue("page-error", webError.error().message, webError.page()?.url() ?? "");
    });
    context.on("response", (response) => {
      if (stopped) return;
      const type = classifyIssue({
        status: response.status(),
        resourceType: response.request().resourceType(),
      });
      if (!type) return;
      addIssue(
        type,
        `${response.status()} ${response.url()}`,
        safeUrl(() => response.frame().page().url()),
      );
    });
    context.on("requestfailed", (request) => {
      if (stopped) return;
      addIssue(
        "request-failed",
        `${request.failure()?.errorText ?? "failed"} ${request.url()}`,
        safeUrl(() => request.frame().page().url()),
      );
    });

    await context.addInitScript(cursorInitScript());
    page = await context.newPage();
    // メインフレームが実ページへコミットしたら「評価成立」とみなす。接続拒否時は
    // load イベントも framenavigated も発火するが、コミット先が Chromium のエラーページ
    // (chrome-error://) になるためこれを除外する。初期 about:blank も評価成立に数えない
    const mainFrame = page.mainFrame();
    page.on("framenavigated", (frame) => {
      if (frame !== mainFrame) return;
      const url = frame.url();
      if (url === "about:blank" || url.startsWith("chrome-error://")) return;
      evaluated = true;
    });
  } catch (err) {
    // finish が呼び出し側に渡る前の失敗はここでしか後始末できない（Chromium リーク防止）
    await browser.close();
    throw err;
  }

  return {
    page,
    mark: (label: string) => {
      currentMark = label;
    },
    screenshot: async (label: string) => {
      shotIndex += 1;
      await page.screenshot({ path: join(dir, shotFileName(shotIndex, label)) });
    },
    onStep: (step: Step, index: number) => {
      currentStepIndex = index;
      stepsLedger.push({ index, step, status: "ok" });
    },
    finish: async ({ scenarioType, failureMessage }) => {
      // 以降に届くイベントは受け付けず、ここまでに登録された Promise だけを drain する。
      // stopped を立てる前に Promise.all を呼ぶと、close 直前・close 中に発火した
      // response/requestfailed 等が新しい Promise を追加でき、待ち漏れが起きる
      stopped = true;
      await Promise.all(pendingIssues);

      let failure: Failure | null = null;
      // 最初の評価成立前の接続クラス失敗だけを「評価不能」に読み替える。評価成立後の
      // ネットワーク断はアプリ退行の可能性を排除できないため fail のままにする
      const inconclusiveReason =
        failureMessage !== undefined && !evaluated && isConnectionClassError(failureMessage)
          ? failureMessage
          : undefined;
      if (failureMessage !== undefined) {
        const stepIndex = currentStepIndex;
        const entry =
          stepIndex !== null ? stepsLedger.find((e) => e.index === stepIndex) : undefined;
        if (entry) entry.status = "failed";

        let failureScreenshot: string | null = null;
        try {
          await page.screenshot({ path: join(dir, "failure.png") });
          failureScreenshot = "failure.png";
        } catch {
          // ページが既に閉じている等で撮影できないことがある
        }
        failure = {
          stepIndex,
          message: failureMessage,
          url: page.url(),
          screenshot: failureScreenshot,
        };
      }

      const video = page.video();
      const videoFileName = "video.mp4";
      const videoPath = join(dir, videoFileName);
      let conversionError: unknown;
      let report: SmokeReport;
      let reportPath: string;

      try {
        try {
          await context.close();
        } finally {
          // context.close() が失敗しても Chromium プロセスをリークさせない
          await browser.close();
        }

        if (video) {
          try {
            const webmPath = await video.path();
            convertToMp4(webmPath, videoPath);
            rmSync(webmPath, { force: true });
          } catch (err) {
            // 変換失敗時も report.json は書き切り、エラーは後段で re-throw して
            // exit 2 経路（未捕捉エラー）に乗せる
            conversionError = err;
          }
        }
      } finally {
        // ここまでのどの失敗経路でも report.json は必ず書き出す
        report = buildReport({
          name,
          video: videoFileName,
          scenarioType,
          steps: stepsLedger,
          failure,
          issues,
          inconclusiveReason,
        });
        reportPath = join(dir, "report.json");
        writeFileSync(reportPath, JSON.stringify(report, null, 1));
      }

      if (conversionError) throw conversionError;
      return { report, reportPath, videoPath };
    },
  };
};
