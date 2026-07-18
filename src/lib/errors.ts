// 設定・シナリオ不正（終了コード1）を実行時失敗（終了コード2）と区別するためのマーカー。
// 環境不備（ffmpeg 不在など）は exitCode 2 を明示して友好的メッセージのまま実行時失敗として扱う。
// 3 は smoke の評価不能（inconclusive）用に予約（smoke 経路のみが使う）。
export class UserError extends Error {
  readonly exitCode: 1 | 2 | 3;

  constructor(message: string, exitCode: 1 | 2 | 3 = 1) {
    super(message);
    this.name = "UserError";
    this.exitCode = exitCode;
  }
}
