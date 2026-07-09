import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// dist/cli.js から実行される場合と tsx で src から実行される場合の両方で
// node_modules 配下からでも正しく解決できるよう、固定の深さに頼らず package.json を上方向に探す。
export const findPackageRoot = (fromModuleUrl: string): string => {
  let dir = dirname(fileURLToPath(fromModuleUrl));
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (pkg.name === "demoreel") return dir;
      } catch {
        // 壊れた package.json は無視して上方向に探索を続ける
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`could not locate the demoreel package root above ${dir}`);
    }
    dir = parent;
  }
};
