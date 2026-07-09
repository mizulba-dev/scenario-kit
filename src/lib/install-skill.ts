import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findPackageRoot } from "./package-root";

export interface InstallSkillOptions {
  cwd?: string;
  /** Install to ~/.claude/skills/demoreel/ instead of the project's .claude/ and .agents/ dirs */
  user?: boolean;
}

export const runInstallSkill = (options: InstallSkillOptions = {}): string[] => {
  const cwd = options.cwd ?? process.cwd();
  const packageRoot = findPackageRoot(import.meta.url);
  const skill = readFileSync(join(packageRoot, "src", "templates", "SKILL.md"), "utf8");

  const targetDirs = options.user
    ? [join(homedir(), ".claude", "skills", "demoreel")]
    : [join(cwd, ".claude", "skills", "demoreel"), join(cwd, ".agents", "skills", "demoreel")];

  return targetDirs.map((dir) => {
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, "SKILL.md");
    writeFileSync(dest, skill);
    return dest;
  });
};
