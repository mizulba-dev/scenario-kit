import { chromium } from "playwright";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { UserError } from "./errors";

export interface LoginOptions {
  /** scenario-kit/config.json のあるディレクトリ */
  dir: string;
  /** 保存先（config.storageState）。未指定なら dir/.auth/state.json */
  storageState?: string;
  url?: string;
}

export interface LoginResult {
  path: string;
  /** config.storageState 未設定でデフォルトパスに保存したか（CLI が config 追記案内を出す） */
  usedDefaultPath: boolean;
}

export const DEFAULT_STORAGE_STATE = join(".auth", "state.json");

export const assertLoginUrl = (url: string): void => {
  if (!/^https?:\/\//.test(url)) {
    throw new UserError(`invalid url "${url}": must start with http:// or https://`);
  }
};

export const hasGitignoreEntry = (content: string, entry: string): boolean =>
  content.split(/\r?\n/).some((line) => line.trim() === entry);

// 認証情報を含むファイルの誤コミット防止。dir/.auth/ 配下に保存するときだけ面倒を見る
// （カスタムパスはユーザーの管理範囲とみなす）
const ensureAuthIgnored = (dir: string, statePath: string): void => {
  if (!statePath.startsWith(join(dir, ".auth") + sep)) return;
  const gitignorePath = join(dir, ".gitignore");
  const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (hasGitignoreEntry(content, ".auth/")) return;
  const prefix = content === "" || content.endsWith("\n") ? "" : "\n";
  appendFileSync(gitignorePath, `${prefix}.auth/\n`);
};

export const runLogin = async (options: LoginOptions): Promise<LoginResult> => {
  if (options.url) assertLoginUrl(options.url);
  const usedDefaultPath = !options.storageState;
  const path = options.storageState ?? join(options.dir, DEFAULT_STORAGE_STATE);

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (options.url) await page.goto(options.url);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      // ブラウザが先に閉じられると storageState() を取れないため、閉鎖検知と Enter を競わせる
      const disconnected = new Promise<"disconnected">((resolve) => {
        browser.on("disconnected", () => resolve("disconnected"));
      });
      const answered = rl
        .question("log in in the opened browser, then press Enter to save the session > ")
        .then(() => "answered" as const);
      if ((await Promise.race([disconnected, answered])) === "disconnected") {
        throw new UserError(
          "browser was closed before the session was saved. Run login again and press Enter in this terminal before closing the browser.",
          2,
        );
      }
    } finally {
      rl.close();
    }

    mkdirSync(dirname(path), { recursive: true });
    await context.storageState({ path });
    ensureAuthIgnored(options.dir, path);
    return { path, usedDefaultPath };
  } finally {
    await browser.close();
  }
};
