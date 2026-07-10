#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { assertFfmpegAvailable, convertToMp4, probeDuration } from "./lib/ffmpeg";
import { loadConfig } from "./lib/config";
import { UserError } from "./lib/errors";
import { runInit } from "./lib/init";
import { runLogin } from "./lib/login";
import { runInstallSkill } from "./lib/install-skill";
import { startRecording } from "./lib/recorder";
import { renderDemo } from "./lib/render";
import { loadScenario } from "./lib/scenario-loader";
import { STEP_KEYS } from "./lib/steps";

const HELP = `scenario-kit - record and render product demo videos from a JSON scenario

Usage:
  scenario-kit record <name>       Record a scenario to scenario-kit/out/recordings/<name>.webm
  scenario-kit render <name>       Convert + composite the recording into scenario-kit/out/<name>-demo.mp4
  scenario-kit run <name>          record + render
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

const runRecord = async (args: string[]): Promise<number> => {
  const name = requireName(args);
  const config = loadConfig();
  const scenario = await loadScenario(config.scenariosDir, name);

  const { page, mark, finish } = await startRecording({
    dir: join(config.outDir, "recordings"),
    name,
    storageState: config.storageState,
  });

  let videoPath: string;
  try {
    await scenario({ page, mark });
  } finally {
    // scenario 失敗時も必ず finish() でブラウザを閉じる（Chromium リーク防止）
    ({ videoPath } = await finish());
  }
  console.log(`recorded: ${videoPath}`);
  return 0;
};

const runRender = async (args: string[]): Promise<number> => {
  const name = requireName(args);
  assertFfmpegAvailable();
  const config = loadConfig();

  const webm = join(config.outDir, "recordings", `${name}.webm`);
  if (!existsSync(webm)) {
    throw new UserError(`recording not found: ${webm} (run "scenario-kit record ${name}" first)`);
  }

  const publicDir = join(config.outDir, "public");
  mkdirSync(publicDir, { recursive: true });
  const mp4 = join(publicDir, `${name}.mp4`);
  convertToMp4(webm, mp4);
  const durationSec = probeDuration(mp4);

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
  });
  console.log(`rendered: ${outFile}`);
  return 0;
};

const runRun = async (args: string[]): Promise<number> => {
  // record 完了後に ffmpeg 未導入で失敗するのを避けるため、録画前に先んじて確認する
  assertFfmpegAvailable();
  const recordCode = await runRecord(args);
  if (recordCode !== 0) return recordCode;
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
