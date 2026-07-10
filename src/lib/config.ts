import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseBrand, type Brand } from "./brand";
import { UserError } from "./errors";

export interface ScenarioKitConfig {
  /** scenario-kit/config.json が置かれているディレクトリ */
  dir: string;
  /** シナリオファイル（<name>.json / <name>.ts）を解決するディレクトリ（dir/scenarios 固定） */
  scenariosDir: string;
  brand: Brand;
  outDir: string;
  storageState?: string;
  intro: boolean;
  outro: boolean;
}

const CONFIG_RELATIVE_PATH = join("scenario-kit", "config.json");

export const findConfigPath = (startDir: string): string => {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new UserError(
        `scenario-kit/config.json not found (searched upward from ${resolve(startDir)}). Run "scenario-kit init" first.`,
      );
    }
    dir = parent;
  }
};

const resolveRelative = (dir: string, value: string): string =>
  isAbsolute(value) ? value : join(dir, value);

const CONFIG_TOP_LEVEL_KEYS = ["brand", "outDir", "storageState", "intro", "outro"] as const;

export const parseConfig = (dir: string, value: unknown): ScenarioKitConfig => {
  if (typeof value !== "object" || value === null) {
    throw new UserError("scenario-kit/config.json must be an object");
  }
  const record = value as Record<string, unknown>;

  const unknownKeys = Object.keys(record).filter(
    (key) => !(CONFIG_TOP_LEVEL_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new UserError(
      `scenario-kit/config.json: unknown key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")} (expected only ${CONFIG_TOP_LEVEL_KEYS.join(", ")})`,
    );
  }

  let brand: Brand;
  try {
    brand = parseBrand(record.brand);
  } catch (err) {
    throw new UserError(
      `scenario-kit/config.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (brand.logo) {
    brand = { ...brand, logo: resolveRelative(dir, brand.logo) };
  }

  if (record.outDir !== undefined && typeof record.outDir !== "string") {
    throw new UserError('scenario-kit/config.json: "outDir" must be a string');
  }
  const outDir = resolveRelative(dir, (record.outDir as string | undefined) ?? "out");

  if (record.storageState !== undefined && typeof record.storageState !== "string") {
    throw new UserError('scenario-kit/config.json: "storageState" must be a string');
  }
  const storageState = record.storageState
    ? resolveRelative(dir, record.storageState as string)
    : undefined;

  if (record.intro !== undefined && typeof record.intro !== "boolean") {
    throw new UserError('scenario-kit/config.json: "intro" must be a boolean');
  }
  const intro = (record.intro as boolean | undefined) ?? true;

  if (record.outro !== undefined && typeof record.outro !== "boolean") {
    throw new UserError('scenario-kit/config.json: "outro" must be a boolean');
  }
  const outro = (record.outro as boolean | undefined) ?? true;

  return { dir, scenariosDir: join(dir, "scenarios"), brand, outDir, storageState, intro, outro };
};

export const loadConfig = (startDir: string = process.cwd()): ScenarioKitConfig => {
  const configPath = findConfigPath(startDir);
  const dir = dirname(configPath);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new UserError(
      `failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseConfig(dir, value);
};
