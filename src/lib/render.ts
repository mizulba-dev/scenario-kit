import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Brand } from "./brand";
import { findPackageRoot } from "./package-root";
import type { DemoProps } from "../remotion/Demo";

export interface RenderOptions {
  srcName: string;
  durationSec: number;
  brand: Brand;
  /** 変換後 mp4 が置かれているディレクトリ。staticFile(srcName) はここを基準に解決される */
  publicDir: string;
  outFile: string;
  intro: boolean;
  outro: boolean;
}

export const renderDemo = async (options: RenderOptions): Promise<void> => {
  const packageRoot = findPackageRoot(import.meta.url);
  const entryPoint = join(packageRoot, "src", "remotion", "index.ts");

  const bundleLocation = await bundle({
    entryPoint,
    publicDir: options.publicDir,
  });

  const inputProps: DemoProps = {
    srcName: options.srcName,
    durationSec: options.durationSec,
    brand: options.brand,
    intro: options.intro,
    outro: options.outro,
  };

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "demo",
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: options.outFile,
    inputProps,
  });
};
