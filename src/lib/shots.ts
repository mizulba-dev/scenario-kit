import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface ShotsOptions {
  dir: string;
  viewport?: { width: number; height: number };
  locale?: string;
  storageState?: string;
}

export interface ShotsSession {
  page: Page;
  highlight: (locator: string) => Promise<void>;
  screenshot: (label: string) => Promise<void>;
  finish: () => Promise<void>;
}

// / と \ はファイル名の区切りと衝突するため、制御文字とあわせて - に置換する。
// 日本語を含むそれ以外の文字はラベルの可読性のため保持する
// eslint-disable-next-line no-control-regex -- ファイル名に混入し得る制御文字を意図的に除去する
const sanitizeLabel = (label: string): string => label.replace(/[/\\\x00-\x1f\x7f]/g, "-");

export const shotFileName = (index: number, label: string): string =>
  `${String(index).padStart(2, "0")}-${sanitizeLabel(label)}.png`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// boundingBox から 4px 外側にはみ出させて描画する。page.evaluate でシリアライズされる
// ため、外部参照なしで自己完結させる慣例は cursor.ts に合わせる
const injectHighlight = ([box, id]: [Box, string]): void => {
  const el = document.createElement("div");
  el.id = id;
  // ページ側のグローバル CSS に寸法が左右されないよう box-sizing を明示する。
  // border-box なので枠線 3px を含めて 7px 外側 = 対象と枠線内縁の隙間が全辺 4px
  Object.assign(el.style, {
    position: "fixed",
    boxSizing: "border-box",
    left: `${box.x - 7}px`,
    top: `${box.y - 7}px`,
    width: `${box.width + 14}px`,
    height: `${box.height + 14}px`,
    border: "3px solid #FF3355",
    borderRadius: "6px",
    boxShadow: "0 0 0 2px rgba(255,255,255,.7)",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(el);
};

const clearHighlights = (): void => {
  for (const el of document.querySelectorAll('[id^="__demo_highlight"]')) {
    el.remove();
  }
};

export const startShots = async (options: ShotsOptions): Promise<ShotsSession> => {
  const viewport = options.viewport ?? { width: 1440, height: 900 };
  // 前回実行の残骸連番が混ざらないよう、実行冒頭で出力ディレクトリを作り直す
  rmSync(options.dir, { recursive: true, force: true });
  mkdirSync(options.dir, { recursive: true });

  const browser: Browser = await chromium.launch();
  let context: BrowserContext;
  let page: Page;
  try {
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      locale: options.locale ?? "ja-JP",
      storageState: options.storageState,
    });
    page = await context.newPage();
  } catch (err) {
    // finish が呼び出し側に渡る前の失敗はここでしか後始末できない（Chromium リーク防止）
    await browser.close();
    throw err;
  }

  let shotIndex = 0;
  let highlightSeq = 0;

  const highlight = async (locator: string): Promise<void> => {
    const box = await page.locator(locator).boundingBox();
    if (!box) {
      throw new Error(`highlight: locator not found or not visible: "${locator}"`);
    }
    highlightSeq += 1;
    const arg: [Box, string] = [box, `__demo_highlight-${highlightSeq}`];
    await page.evaluate(injectHighlight, arg);
  };

  const screenshot = async (label: string): Promise<void> => {
    shotIndex += 1;
    await page.screenshot({ path: join(options.dir, shotFileName(shotIndex, label)) });
    await page.evaluate(clearHighlights);
  };

  return {
    page,
    highlight,
    screenshot,
    finish: async () => {
      await context.close();
      await browser.close();
    },
  };
};
