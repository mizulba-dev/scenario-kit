---
name: demoreel
description: Record and regenerate this project's product demo video with demoreel (Playwright recording + Remotion compositing). Use when asked to create, update, or regenerate a demo video, or to add a new demo scenario.
allowed-tools: Bash(npx demoreel:*)
---

# demoreel

`demoreel` records a product demo by driving a real browser (Playwright), then
composites the recording into a branded mp4 (Remotion): intro card → rounded
browser window → outro card.

This project's demo config and scenarios live in `demoreel/` at the project
root:

```
demoreel/
  config.json     brand + output settings
  <name>.json      one or more recording scenarios
  out/             generated recordings and mp4s (gitignored)
```

## Commands

```bash
npx demoreel run <name>      # record + render in one step
npx demoreel record <name>   # record only -> demoreel/out/recordings/<name>.webm
npx demoreel render <name>   # convert + composite only -> demoreel/out/<name>-demo.mp4
npx demoreel init            # scaffold demoreel/ in a new project
npx demoreel --help          # full command and steps reference
```

Requires `ffmpeg`/`ffprobe` on PATH, and `npx playwright install chromium`
once per machine.

## Writing a scenario

A scenario is a JSON file next to `config.json` (e.g. `demoreel/landing.json`)
with a `steps` array. Each step is a single-key object:

| step      | argument          | effect                         |
| --------- | ----------------- | ------------------------------ |
| `goto`    | url               | navigate to a URL              |
| `click`   | locator           | click a Playwright locator     |
| `type`    | `[locator, text]` | type text into a locator       |
| `move`    | `[x, y]`          | move the mouse cursor          |
| `scroll`  | y                 | smooth-scroll to a Y offset    |
| `pause`   | ms                | wait                           |
| `waitFor` | locator           | wait for a locator to appear   |
| `mark`    | label             | record a named timeline marker |

`locator` is any Playwright locator string (e.g. `text=Get started`,
`#hero`, `[data-testid=cta]`).

Example `demoreel/landing.json`:

```json
{
  "$schema": "https://unpkg.com/demoreel/schema/scenario.schema.json",
  "steps": [
    { "goto": "https://example.com" },
    { "move": [720, 400] },
    { "pause": 1000 },
    { "mark": "hero" },
    { "scroll": 800 },
    { "mark": "section-1" },
    { "pause": 500 }
  ]
}
```

The `$schema` field (written by `demoreel init`) gives editors validation and
autocomplete for the steps above — write scenarios by hand or generate them,
then run `npx demoreel run <name>` to check the result.

For scripted interactions the JSON vocabulary can't express, use a
`<name>.ts` scenario instead (`demoreel/landing.ts`, resolved when no
`<name>.json` exists). A plain default-exported async function is enough —
no import of `demoreel` required, so this works with `npx demoreel` alone:

```ts
export default async ({ page, mark }) => {
  await page.goto("https://example.com");
  mark("hero");
};
```

If `demoreel` is a dependency of the project, wrap it in `defineScenario`
for typed `page`/`mark` parameters (an identity function, for type-checking
only):

```ts
import { defineScenario } from "demoreel";

export default defineScenario(async ({ page, mark }) => {
  await page.goto("https://example.com");
  mark("hero");
});
```
