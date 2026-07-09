# demoreel

Record a product demo with a real browser (Playwright), then composite it
into a branded mp4 (Remotion) — intro card, rounded browser window, outro
card. Drive it from a declarative JSON scenario, no code required.

> First run downloads a Chrome build for rendering and, if needed, Chromium
> for Playwright — expect a multi-hundred-MB one-time download.

## Quick start

```bash
npx demoreel init             # scaffold demoreel/config.json + demoreel/landing.json
npx playwright install chromium   # once per machine
npx demoreel run landing      # record + render -> demoreel/out/landing-demo.mp4
```

`ffmpeg` and `ffprobe` must be on `PATH` (used to convert the Playwright
recording to h264 before compositing).

## Project layout

Everything lives in a `demoreel/` directory at your project root:

```
demoreel/
  config.json     brand + output settings
  landing.json    a recording scenario (add more: demoreel/<name>.json)
  out/            generated recordings and mp4s (gitignored by init)
```

`demoreel/config.json`:

```jsonc
{
  "brand": { "name": "...", "tagline": "...", "url": "...", "bg": "#1E293B", "accent": "#6366F1", "text": "#F8FAFC" },
  "outDir": "out",                    // optional, default "out" (relative to demoreel/)
  "storageState": ".auth/state.json"  // optional, a Playwright storageState file for logged-in demos
}
```

## Writing a scenario

`demoreel/<name>.json` has a `steps` array. Each step is a single-key object:

| step | argument | effect |
| --- | --- | --- |
| `goto` | url | navigate to a URL |
| `click` | locator | click a Playwright locator |
| `type` | `[locator, text]` | type text into a locator |
| `move` | `[x, y]` | move the mouse cursor |
| `scroll` | y | smooth-scroll to a Y offset |
| `pause` | ms | wait |
| `waitFor` | locator | wait for a locator to appear |
| `mark` | label | record a named timeline marker |

`locator` is any Playwright locator string (`text=Get started`, `#hero`,
`[data-testid=cta]`, ...). Unknown step keys are rejected before recording
starts. See `npx demoreel --help` for the full reference, or
[`schema/scenario.schema.json`](./schema/scenario.schema.json) for editor
validation and autocomplete (referenced by the `$schema` field `init`
writes into `landing.json`).

For interactions the JSON vocabulary can't express, write `demoreel/<name>.ts`
instead (resolved when no matching `<name>.json` exists). It just needs a
default-exported async function — no import of `demoreel` required, so this
works with `npx demoreel` alone, even when your project has no dependency on
`demoreel`:

```ts
export default async ({ page, mark }) => {
  await page.goto('https://example.com');
  mark('hero');
};
```

If `demoreel` is a dependency of your project, wrap it in `defineScenario`
for typed `page`/`mark` parameters — it's an identity function, purely for
type-checking:

```ts
import { defineScenario } from 'demoreel';

export default defineScenario(async ({ page, mark }) => {
  await page.goto('https://example.com');
  mark('hero');
});
```

## Commands

```bash
demoreel init                     scaffold demoreel/ in the current project
demoreel record <name>            record a scenario to demoreel/out/recordings/<name>.webm
demoreel render <name>            convert + composite into demoreel/out/<name>-demo.mp4
demoreel run <name>               record + render
demoreel install-skill            install the demoreel SKILL.md into .claude/skills/ and .agents/skills/
demoreel install-skill --user     install into ~/.claude/skills/demoreel/ instead
demoreel --help                   full command and steps reference
```

Exit codes: `0` success, `1` invalid config/scenario, `2` runtime failure
(browser, ffmpeg, or render error).

## AI agent skill

`demoreel install-skill` drops a `SKILL.md` into your project so Claude Code
/ Codex-style agents can regenerate demo videos on request — it documents
`npx demoreel` usage and the steps vocabulary, with no bundled scripts.

## Notes

- Not (yet) handled: click-synced zoom, background music, a bundled ffmpeg,
  Windows.
