# scenario-kit

Record a product demo with a real browser (Playwright), then composite it
into a branded mp4 (Remotion) — intro card, rounded browser window, outro
card. Drive it from a declarative JSON scenario, no code required.

> First run downloads a Chrome build for rendering and, if needed, Chromium
> for Playwright — expect a multi-hundred-MB one-time download.

## Quick start

```bash
npx scenario-kit init             # scaffold scenario-kit/config.json + scenario-kit/scenarios/landing.json
npx playwright install chromium   # once per machine
npx scenario-kit run landing      # record + render -> scenario-kit/out/landing-demo.mp4
```

`ffmpeg` and `ffprobe` must be on `PATH` (used to convert the Playwright
recording to h264 before compositing).

## Project layout

Everything lives in a `scenario-kit/` directory at your project root:

```
scenario-kit/
  config.json     brand + output settings
  scenarios/
    landing.json  a recording scenario (add more: scenario-kit/scenarios/<name>.json)
  assets/         brand assets such as logo.png (referenced from config.json)
  out/            generated recordings, screenshots and mp4s (gitignored by init)
```

`scenario-kit/config.json`:

```jsonc
{
  "brand": {
    "name": "...",                    // required, unless "logo" is set (then optional: wordmark shows the logo alone)
    "tagline": "...", "url": "...", "bg": "#1E293B", "accent": "#6366F1", "text": "#F8FAFC",
    "logo": "assets/logo.png"         // optional image (png/svg/...) shown instead of the generated initial icon,
  },                                  // resolved relative to scenario-kit/
  "outDir": "out",                    // optional, default "out" (relative to scenario-kit/)
  "storageState": ".auth/state.json", // optional, a Playwright storageState file for logged-in demos
  "intro": true,                      // optional, default true; set false to drop the intro card
  "outro": true                       // optional, default true; set false to drop the outro card
}
```

## Writing a scenario

`scenario-kit/scenarios/<name>.json` has a `steps` array. Each step is a single-key object:

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
| `highlight` | locator | draw a red highlight box around a locator (`shots` only, no-op in `record`/`qa`) |
| `screenshot` | label | capture the current viewport as a PNG, then clear highlights (`shots`/`qa` only, no-op in `record`) |

`locator` is any Playwright locator string (`text=Get started`, `#hero`,
`[data-testid=cta]`, ...). Unknown step keys are rejected before recording
starts. See `npx scenario-kit --help` for the full reference, or
[`schema/scenario.schema.json`](./schema/scenario.schema.json) for editor
validation and autocomplete (referenced by the `$schema` field `init`
writes into `landing.json`).

For interactions the JSON vocabulary can't express, write `scenario-kit/scenarios/<name>.ts`
instead (resolved when no matching `<name>.json` exists). It just needs a
default-exported async function — no import of `scenario-kit` required, so this
works with `npx scenario-kit` alone, even when your project has no dependency on
`scenario-kit`:

```ts
export default async ({ page, mark }) => {
  await page.goto('https://example.com');
  mark('hero');
};
```

If `scenario-kit` is a dependency of your project, wrap it in `defineScenario`
for typed `page`/`mark` parameters — it's an identity function, purely for
type-checking:

```ts
import { defineScenario } from 'scenario-kit';

export default defineScenario(async ({ page, mark }) => {
  await page.goto('https://example.com');
  mark('hero');
});
```

## Logged-in demos (authentication)

To record pages behind a login, save a logged-in session once:

```bash
npx scenario-kit login https://example.com/login
```

A browser opens — log in manually, then press Enter in the terminal. The
session (a Playwright storageState file: cookies + localStorage) is saved to
`scenario-kit/.auth/state.json` (git-ignored automatically) or to the
configured `storageState` path. Point `storageState` in
`scenario-kit/config.json` at it:

```jsonc
{ "storageState": ".auth/state.json" }
```

Recordings then start already logged in — no login steps in the scenario, no
credentials on disk beyond the session file. When the session expires (the
recording suddenly shows a login page), run `scenario-kit login` again.

## Screenshots

`scenario-kit shots <name>` runs the same scenario as `record`, but captures
PNG screenshots instead of a video — no `ffmpeg`/Remotion involved, and no
pseudo-cursor. Use `highlight` and `screenshot` steps to annotate:

```json
{
  "steps": [
    { "goto": "https://example.com" },
    { "highlight": "text=Get started" },
    { "screenshot": "hero" }
  ]
}
```

Each `screenshot` step writes the current viewport (and clears any pending
highlights afterward) to
`scenario-kit/out/shots/<name>/01-hero.png` (numbered in capture order,
label sanitized for the filename). The output directory is wiped and
recreated at the start of each `shots` run. `highlight`/`screenshot` are
no-ops during `record`, so the same scenario can drive both a demo video
(no red boxes) and release-note screenshots (with them).

## QA

`scenario-kit qa <name>` runs the scenario like `record` (with the pseudo-cursor),
but also watches the page for runtime issues and writes a structured report
instead of compositing a branded video:

```
scenario-kit/out/qa/<name>/
  video.mp4       plain h264 recording (for a human to skim, no intro/outro)
  report.json     structured result — see below
  01-hero.png     checkpoint PNGs from `screenshot` steps (same numbering as shots)
  issue-1.png     auto-captured screenshot at the moment an issue was detected
  failure.png     auto-captured screenshot if a step itself failed
```

It collects 4 kinds of issues while the scenario runs: `console-error`
(`console.error` output), `page-error` (an uncaught exception), `http-error`
(a response with status >= 400 for a `document`/`xhr`/`fetch` request — other
resource types like images/fonts are ignored as noise), and `request-failed`
(a network-level failure). Each issue records the step index (JSON scenarios
only) and the most recent `mark` label for context. Issue screenshots are
capped (one per step index, or 10 total when the step index isn't available,
e.g. TS scenarios) to avoid flooding the output. `highlight` is a no-op in
`qa` (it would show up in the recording); `screenshot` steps work the same as
in `shots`. The output directory is wiped and recreated on each run, and
`qa` requires `ffmpeg`/`ffprobe` on `PATH` like `record`/`run`.

`report.json`:

```json
{
  "name": "landing",
  "ok": false,
  "video": "video.mp4",
  "scenarioType": "json",
  "steps": [{ "index": 0, "step": { "goto": "..." }, "status": "ok" }],
  "failure": { "stepIndex": 4, "message": "...", "url": "https://...", "screenshot": "failure.png" },
  "issues": [
    { "type": "console-error", "message": "...", "pageUrl": "https://...", "stepIndex": 3, "mark": "hero", "screenshot": "issue-1.png" }
  ]
}
```

`ok` is `true` only when the scenario completed without a step failure and
with zero issues. Exit code is `0` when `ok`, `2` otherwise — read
`report.json` and the referenced screenshots to see what went wrong.

## Commands

```bash
scenario-kit init                     scaffold scenario-kit/ in the current project
scenario-kit record <name>            record a scenario to scenario-kit/out/recordings/<name>.webm
scenario-kit render <name>            convert + composite into scenario-kit/out/<name>-demo.mp4
scenario-kit run <name>               record + render
scenario-kit shots <name>             capture PNG screenshots to scenario-kit/out/shots/<name>/ (no video, no ffmpeg)
scenario-kit qa <name>                record + detect runtime issues, writing scenario-kit/out/qa/<name>/{video.mp4,report.json,*.png}
scenario-kit login [url]              log in manually in a browser, save the session for logged-in demos
scenario-kit install-skill            install the scenario-kit SKILL.md into .claude/skills/ and .agents/skills/
scenario-kit install-skill --user     install into ~/.claude/skills/scenario-kit/ instead
scenario-kit --help                   full command and steps reference
```

Exit codes: `0` success, `1` invalid config/scenario, `2` runtime failure
(browser, ffmpeg, or render error).

## AI agent skill

`scenario-kit install-skill` drops a `SKILL.md` into your project so Claude Code
/ Codex-style agents can regenerate demo videos on request — it documents
`npx scenario-kit` usage and the steps vocabulary, with no bundled scripts.

## Notes

- Not (yet) handled: click-synced zoom, background music, a bundled ffmpeg,
  Windows.
