import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installCursor } from './cursor';

export interface DemoEvent {
  t: number;
  type: 'mark' | 'click';
  label?: string;
  x?: number;
  y?: number;
}

export interface Recording {
  page: Page;
  mark: (label: string) => void;
  finish: () => Promise<{ videoPath: string; eventsPath: string }>;
}

export interface RecorderOptions {
  dir: string;
  name: string;
  viewport?: { width: number; height: number };
  locale?: string;
}

const reportClicks = () => {
  window.addEventListener(
    'mousedown',
    (e) => {
      const report = (window as unknown as Record<string, unknown>).__demoEvent as
        | ((ev: { type: string; x: number; y: number }) => void)
        | undefined;
      report?.({ type: 'click', x: e.clientX, y: e.clientY });
    },
    true
  );
};

export const startRecording = async (options: RecorderOptions): Promise<Recording> => {
  const viewport = options.viewport ?? { width: 1440, height: 900 };
  mkdirSync(options.dir, { recursive: true });

  const browser: Browser = await chromium.launch();
  const context: BrowserContext = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    recordVideo: { dir: options.dir, size: viewport },
    locale: options.locale ?? 'ja-JP',
  });

  const events: DemoEvent[] = [];
  await context.exposeBinding('__demoEvent', (_source, ev: { type: string; x: number; y: number }) => {
    events.push({ t: Date.now(), type: 'click', x: ev.x, y: ev.y });
  });
  await context.addInitScript(installCursor);
  await context.addInitScript(reportClicks);

  const page = await context.newPage();

  return {
    page,
    mark: (label: string) => events.push({ t: Date.now(), type: 'mark', label }),
    finish: async () => {
      const video = page.video();
      await context.close();
      const videoPath = join(options.dir, `${options.name}.webm`);
      const eventsPath = join(options.dir, `${options.name}-events.json`);
      if (video) {
        renameSync(await video.path(), videoPath);
      }
      writeFileSync(eventsPath, JSON.stringify(events, null, 1));
      await browser.close();
      return { videoPath, eventsPath };
    },
  };
};
