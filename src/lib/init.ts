import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "./errors";
import { findPackageRoot } from "./package-root";

export interface InitOptions {
  cwd?: string;
}

export const runInit = (options: InitOptions = {}): string => {
  const cwd = options.cwd ?? process.cwd();
  const targetDir = join(cwd, "demoreel");
  const configPath = join(targetDir, "config.json");
  if (existsSync(configPath)) {
    throw new UserError(`${configPath} already exists`);
  }

  const packageRoot = findPackageRoot(import.meta.url);
  const templatesDir = join(packageRoot, "src", "templates", "init");
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  };

  mkdirSync(targetDir, { recursive: true });

  writeFileSync(configPath, readFileSync(join(templatesDir, "config.json"), "utf8"));

  const landingTemplate = JSON.parse(
    readFileSync(join(templatesDir, "landing.json"), "utf8"),
  ) as Record<string, unknown>;
  const landing = {
    $schema: `https://unpkg.com/demoreel@${pkg.version}/schema/scenario.schema.json`,
    ...landingTemplate,
  };
  writeFileSync(join(targetDir, "landing.json"), `${JSON.stringify(landing, null, 2)}\n`);

  writeFileSync(
    join(targetDir, ".gitignore"),
    readFileSync(join(templatesDir, "gitignore"), "utf8"),
  );

  return targetDir;
};
