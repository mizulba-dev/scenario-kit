import { readFileSync } from 'node:fs';

export interface Brand {
  name: string;
  tagline: string;
  url: string;
  bg: string;
  accent: string;
  text: string;
}

const COLOR_KEYS = ['bg', 'accent', 'text'] as const;
const TEXT_KEYS = ['name', 'tagline', 'url'] as const;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export const parseBrand = (value: unknown): Brand => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('brand config must be an object');
  }
  const record = value as Record<string, unknown>;
  for (const key of [...TEXT_KEYS, ...COLOR_KEYS]) {
    if (typeof record[key] !== 'string' || record[key] === '') {
      throw new Error(`brand config: "${key}" must be a non-empty string`);
    }
  }
  for (const key of COLOR_KEYS) {
    if (!HEX.test(record[key] as string)) {
      throw new Error(`brand config: "${key}" must be a hex color like #1E293B`);
    }
  }
  return record as unknown as Brand;
};

export const loadBrand = (path: string): Brand =>
  parseBrand(JSON.parse(readFileSync(path, 'utf8')));
