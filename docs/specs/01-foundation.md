---
status: confirmed
範囲: リポジトリの足場、make verify、層の規則、共通層（M23）、DB の接続とマイグレーションの仕組み（M21）
---

# 01. 開発の足場と共通の部品 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend ｜ **範囲**: リポジトリの足場、make verify、層の規則、共通層（M23）、DB の接続とマイグレーションの仕組み（M21）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

全ての仕様書が使う足場（Next.js と TypeScript のリポジトリ、検証のコマンド、層の規則）と、共通層（DD-01 M23）、DB の接続（DD-01 M21）を作る。

## 2. 入出力

入力: 無し。出力: `make verify`（DD-09 5章）、M23 の関数、M21 の関数。

## 3. 処理詳細

- 層と依存の向き: DD-01 1章。
- 共通層の中身: DD-01 M23、DD-02 3章 P05（乱数と照合値）・P09（日時）、DD-06 2章（内部のエラーコード）・5章（ログ）、DD-09 2.3（設定の名前）、2.6（日ごとのログ。CR-013）。
- DB の接続とマイグレーションの仕組み: DD-03 5章、DD-05 1章、DD-09 2.1（起動のときの確かめ）。

## 4. 設定値・確定値

- 日時の形は `YYYY-MM-DDTHH:MM:SS.sss+09:00`（DD-03 1章）。
- 接続は WAL、外部キーを有効、`busy_timeout` 5,000 ミリ秒（DD-05 1章）。
- ログは 30 日より古い日のファイルを消す（NFR-025、CR-013）。
- 版は `package.json` で固定する（DD-01 3章）。

## 5. インターフェース

M23 と M21 の公開する操作（DD-01 2章）。

## 6. エラー処理

DD-06 E08（DB が使えない）、E16（予期しない失敗）、E17（起動の条件が合わない）。

## 7. スコープ外

テーブルの定義（02-data-model.md）、画面（06-app-shell.md 以降）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`02-data-model.md`](./02-data-model.md)

## 9. 実装単位

- [x] [Backend] Next.js（App Router）と TypeScript のリポジトリの足場、Tailwind CSS、Prettier、ESLint（Next.js の標準）、Vitest と Testing Library と jsdom、Redocly CLI、`make verify`、`.nvmrc` と `engines`、`.gitignore`（`.data/`）を置く（NFR-011、DD-01 M01、DD-09 5章、X-07 3章、ADR-006、ADR-021、ADR-022）（se/01-foundation）
  - 受け入れ基準: Makefile の verify の目標が、Prettier の確かめ、ESLint、型の確かめ、Redocly CLI の lint、Vitest の5つの手順をこの順に呼ぶ（Makefile を見て一つに決まる）; .nvmrc と package.json の engines に同じ Node.js の番号がある; .gitignore に .data/ がある; verify の5つの手順に、npm の置き場所へ通信する手順が無い
- [x] [Backend] 層の規則（`import/no-restricted-paths`、`import/no-cycle`、`node:child_process` の制限）と空の `catch` の禁止を ESLint の設定に入れる（NFR-016、DD-01 M26、DD-06 1章）（se/01-foundation）
  - 受け入れ基準: DD-10 TC101 が通る
- [x] [Backend] 共通層 M23（時計と偽の時計、日時の形、乱数と照合値、MSG の一覧、エラーの型と内部のエラーコード、設定の読み込み、日ごとのファイルに書くログ）を作る（DD-01 M23、DD-02 3章 P05・P09、DD-06 2章・5章、CR-013）（se/01-foundation）
  - 受け入れ基準: DD-10 TC106、DD-10 TC111 が通る
- [x] [Backend] DB の接続 M21（WAL、外部キー、`busy_timeout`、トランザクションの関数、マイグレーションを番号の順に当てる仕組み、起動のときの FTS5 の trigram と `backup` の確かめ）を作る（DD-01 M21、DD-03 5章、DD-05 1章、DD-09 2.1、ADR-020）（se/01-foundation）
  - 受け入れ基準: DD-10 TC109 が通る
- [ ] [Backend] `npm run build` で、Next.js の画面に加えて、AI Runner（`src/runner/main.ts`）、定期ジョブ（`src/jobs/main.ts`）、管理のコマンド（`src/cli/main.ts`）の TypeScript を `dist/` に JavaScript で書き出し、マイグレーションの `.sql` も写す（DD-09 2.6・4章 手順 2。本番の構築 OP01 で見つけた不具合。2026-11-26）
  - 受け入れ基準: `npm run build` の後に `dist/runner/main.js`、`dist/jobs/main.js`、`dist/cli/main.js` がある; DD-10 TC85 の起動の試験（`node dist/jobs/main.js backup`）が、試験の中で `dist/` を作らず、`npm run build` と同じ変換の手順で作った `dist/` を使って通る
