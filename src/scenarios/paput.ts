import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { startRecording } from '../lib/recorder';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const smoothScrollTo = async (page: Page, y: number, waitMs = 1500): Promise<void> => {
  await page.evaluate(
    ([top]) => window.scrollTo({ top, behavior: 'smooth' }),
    [y] as const
  );
  await page.waitForTimeout(waitMs);
};

const { page, mark, finish } = await startRecording({
  dir: join(root, 'out', 'recordings'),
  name: 'paput',
});

mark('start');
await page.goto('https://paput.io', { waitUntil: 'networkidle' });
await page.mouse.move(720, 400, { steps: 30 });
await page.waitForTimeout(1200);

// ヒーローを見せてから特徴セクションへ、間延びしないテンポでスクロール
mark('hero');
await page.mouse.move(900, 550, { steps: 25 });
await smoothScrollTo(page, 760);
mark('section-1');
await page.mouse.move(620, 480, { steps: 25 });
await smoothScrollTo(page, 1560);
mark('section-2');
await page.mouse.move(820, 470, { steps: 25 });
await smoothScrollTo(page, 2400);
mark('section-3');
await page.mouse.move(700, 500, { steps: 25 });
await smoothScrollTo(page, 3300);
mark('section-4');
await page.waitForTimeout(800);
mark('end');

const { videoPath } = await finish();
console.log('recorded:', videoPath);
