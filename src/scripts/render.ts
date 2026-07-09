import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrand } from '../lib/brand';
import { convertToMp4, probeDuration } from '../lib/ffmpeg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scenario = process.argv[2] ?? 'paput';

const brand = loadBrand(join(root, 'brand', `${scenario}.json`));
const webm = join(root, 'out', 'recordings', `${scenario}.webm`);
const mp4 = join(root, 'public', `${scenario}.mp4`);
mkdirSync(join(root, 'public'), { recursive: true });

convertToMp4(webm, mp4);
const durationSec = probeDuration(mp4);

const propsPath = join(root, 'out', `${scenario}-props.json`);
writeFileSync(propsPath, JSON.stringify({ srcName: `${scenario}.mp4`, durationSec, brand }));

const out = join(root, 'out', `${scenario}-demo.mp4`);
execFileSync(
  'npx',
  ['remotion', 'render', 'src/remotion/index.ts', 'demo', out, `--props=${propsPath}`],
  { stdio: 'inherit', cwd: root }
);
console.log('done:', out);
