import { readFileSync } from "node:fs";

export interface Brand {
  /** logo 指定時のみ省略可（省略時 Wordmark はロゴ単体表示になる） */
  name?: string;
  tagline: string;
  url: string;
  bg: string;
  accent: string;
  text: string;
  /** ロゴ画像。config 読込時はファイルパス、Remotion に渡る時点では staticFile 名 */
  logo?: string;
}

const COLOR_KEYS = ["bg", "accent", "text"] as const;
const TEXT_KEYS = ["tagline", "url"] as const;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export const parseBrand = (value: unknown): Brand => {
  if (typeof value !== "object" || value === null) {
    throw new Error("brand config must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of [...TEXT_KEYS, ...COLOR_KEYS]) {
    if (typeof record[key] !== "string" || record[key] === "") {
      throw new Error(`brand config: "${key}" must be a non-empty string`);
    }
  }
  for (const key of COLOR_KEYS) {
    if (!HEX.test(record[key] as string)) {
      throw new Error(`brand config: "${key}" must be a hex color like #1E293B`);
    }
  }
  if (record.logo !== undefined && (typeof record.logo !== "string" || record.logo === "")) {
    throw new Error('brand config: "logo" must be a non-empty string (path to an image file)');
  }
  if (record.name === undefined) {
    if (!record.logo) {
      throw new Error('brand config: "name" is required unless "logo" is set');
    }
  } else if (typeof record.name !== "string" || record.name === "") {
    throw new Error('brand config: "name" must be a non-empty string');
  }
  return record as unknown as Brand;
};

export const loadBrand = (path: string): Brand =>
  parseBrand(JSON.parse(readFileSync(path, "utf8")));
