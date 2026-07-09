# demo-video

製品紹介デモ動画をコードから再生成するパイプライン。シナリオ（Playwright）が製品 UI を操作しながら録画し、Remotion がブランド背景・角丸ウィンドウフレーム・イントロ/アウトロカードを合成して mp4 を出力する。UI が変わってもシナリオ再実行で最新の動画を作り直せる。

見た目の参照は Claude 公式コネクタ紹介動画の型（単色ブランド背景・角丸ウィンドウ・カーソル常時可視・1カット3〜5秒）。

## 使い方

```bash
npm run record            # シナリオを実行して out/recordings/<name>.webm を録画
npm run render -- paput   # 変換・合成して out/<name>-demo.mp4 を出力
npm run studio            # Remotion Studio でコンポジションをプレビュー
npm test                  # ユニットテスト
npm run typecheck
```

初回のみ `npx playwright install chromium` が必要。ffmpeg / ffprobe が PATH にあること。

## 構成

```
brand/<name>.json      ブランド設定（色・ロゴ文字・タグライン・URL）。製品ごとに追加
src/scenarios/<name>.ts  録画シナリオ。startRecording() で擬似カーソル・クリック記録付きの page を得る
src/lib/               recorder / cursor / brand / ffmpeg / timing（テスト対象）
src/remotion/          コンポジション（イントロ → ウィンドウフレーム → アウトロ）
src/scripts/render.ts  webm→mp4 変換 → 尺計測 → Remotion レンダリング
out/                   録画・イベントログ・完成動画（git 管理外）
```

## 前提としている実測知見

- Playwright の recordVideo にはカーソルが映らない → `installCursor` を addInitScript で注入
- Playwright の webm は duration メタデータを持たないことがある → h264 mp4 に変換してから ffprobe で尺を取る
- カットのテンポは合成側では直せない → シナリオ側の待機時間で調整する
- クリック座標は `out/recordings/<name>-events.json` に記録される（将来のクリック連動ズーム用）

## 新しい製品・シナリオの追加

1. `brand/<name>.json` を作る（bg / accent / text は hex 6桁）
2. `src/scenarios/<name>.ts` を書く（paput.ts を雛形に）
3. `npm run record -- <name> && npm run render -- <name>`

ログインが必要な画面は録画専用アカウント + `storageState` を使う（実データ・トークン・顧客情報を映さない）。
