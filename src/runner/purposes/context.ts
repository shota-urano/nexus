// M24 が拾った実行ごとに M25 へ渡すもの（DD-02 3章 P06 手順 3）。
export interface ExecuteContext {
  // 止める合図。時間の上限を超えたら、M24 が理由（NexusError）を付けて合図する。
  signal?: AbortSignal;
}
