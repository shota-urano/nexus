# 引き継ぎ書（handoff）

> 対話セッションから次の Claude Code セッション（または Codex）への業務引き継ぎ（2026-11-24）。読む側は「次の一手」から始め、「触ってはいけないもの」を変更しない。
> 5節はセッション（LLM）が書く。機械事実の節は scripts が採取したもので、手で直さない。

## 現在地

NEXUS（AI から届く情報を読み・探し・AI に質問する個人用 PWA）を、software-engineer ハーネスの `/se` で上流工程から進めている。依頼の文は `NEXUS_implementation_handoff/NEXUS_IMPLEMENTATION_HANDOFF.md`。要件定義（X-05 PG01）と基本設計（X-05 PG02）を「条件付きで進める」で終え、2026-11-24 に条件を全て解いた（X-05 PG02 の後の「条件1の解決」「条件2の解決」）。Q-066 は本人が公式の文書を読んで判断して決定（CR-006 で NFR-029・AC36 の確かめ方を変えた）。Q-082 は CLI の設定でできると決定し、文書で保証の無い経路は CR-007 で受け入れるリスクにした。本人の希望で、質問の応答では AI に `~/projects/brain-harness` を読むだけで使わせる（CR-005、ADR-016）。これらの反映を Codex が RV12〜RV15 で判定し、止めるの指摘は0件。ADR-016、ADR-017 は本人が全文を読んで承認した。dscheck の lint・glossary・trigger・chain・gate（bd）は全て通っている（2026-11-24）。詳細設計の書類はまだ1冊も無い。アプリの本番のコードは無い。画面の試作は `prototype/`（本番に使わない）。

## 確定済みの判断

- 条件付きの条件は、解いてから次の工程の書類を書く（2026-11-24 本人「条件付きは解決した上で進めたい」）。詳細設計の書類は、Q-066 と Q-082 を解いてから書く。
- 技術と方式は X-02 ADR-006〜ADR-015 で全て承認済み（2026-11-24）。TypeScript、Next.js、Tailwind、Motion、SQLite、Web サーバと AI Runner の2つのプロセスを launchd で動かす、Tailscale Service の専用の名前、登録コードと端末の鍵、AI で記事の関係を判定、DB の待ち行列、SSE、ニュースの図は React Flow。蒸し返さない。
- 未決事項 Q-001〜Q-081 は Q-066 のほか全て決定（X-04）。変更要求 CR-001〜CR-004 は全て反映済み。
- UI の画像は Codex（image-gen スキル）に作らせる。見た目の参考は `NEXUS_implementation_handoff/references/` の参考の画像とモック HTML。要件に無い部品（宣伝文、検索と設定、学習連続、ワークスペース、下の帯）は入れない。ホーム右上の惑星の飾りは本人の希望で入れる（2026-11-24 本人）。
- AI の項目の判定は、書いた AI（Claude）と別のモデル（Codex。`codex exec -s read-only`）が行う。判定の記録は X-05 に原文を写す。点検を通すために記録の言葉を AI だけで書き換えない（2026-11-24。書き換えるときは本人に確かめる）。
- 命名とコーディングの決まりは X-07 2章・3章（snake_case の DB、camelCase と PascalCase の TypeScript、kebab-case のファイル、Prettier と ESLint）。
- Q-066: 問い合わせずに、本人の判断で `claude -p` を本人のサブスクリプションで使う。規約が変わるか指摘があれば Messages API に替える（X-04 Q-066、CR-006、ADR-017。2026-11-24 本人）。
- 質問の応答では、AI に `~/projects/brain-harness` を読むだけで使わせる。NEXUS の内容で分からないとき、ウェブとフォルダのどれを使うかは AI が決める。中身が外へ出る経路は受け入れる（CR-005、ADR-016。2026-11-24 本人）。
- Q-082 で文書から保証が得られなかった経路（IP で直接指した宛先、内部の番地に変わる名前、転送、リンクと `..`、Claude Code が自分で読む設定のファイル）は受け入れる。macOS の側で止める仕組みは作らない（CR-007。2026-11-24 本人）。
- `claude -p` はサブスクリプションのログインで使うので `--bare` は使えない（API キーが要る）。DD-09 で、利用者の設定と brain-harness の `.claude/` を読ませない指定を決める（X-04 Q-082 の答え）。

## 残タスク

1. 詳細設計の書類の採否を見直す: `dscheck tailor` で案を作り直し、本人に承認を求める（AP-BD 1.2、GT-BD G15）。完了条件: X-06 の DD の採否に本人の承認が書かれている。
2. 詳細設計を書く（`dscheck order --phase dd` の順。最初は DD-01）。手順は `/Users/orion/workspace/harnesses/software-engineer/docs/dev-standard/procedures/` の AP-DD。DD-09 には Q-082 の答え（CLI の引数と設定、読ませないファイルの一覧、AC22 の証拠の残し方）を書く。完了条件: 詳細設計の完了判定（PG03）まで。その後、仕様書 `docs/specs/` を書き、本人が確定し、`/se develop`。
3. RD・BD の各書類に残る「Q-066 に左右される」の注記は、Q-066 が決定になったので古い。次にその書類を直すときに、変更要求を起こしてまとめて直す（本人の承認が要る）。

## 次の一手

`/se` を打って `setool status` を確かめる。次に残タスク1（`dscheck tailor` で詳細設計の書類の採否の案を作り直し、本人に承認を求める）に取りかかる。

## 触ってはいけないもの

- 承認済みの書類（RD・X・BD の版 1.x）の中身を、変更要求（CR）や本人の承認なしに直さない。Q を決めて書き足すときは X-04 の決まりに従う。
- X-05 のレビューの記録（RV01〜RV11）と完了判定の記録（PG01、PG02）の判定の中身を書き換えない。点検の道具を通すために記録の言葉を変えるときは、本人に確かめる。
- ハーネス（`/Users/orion/workspace/harnesses/software-engineer`）を直さない。直したいことは本人に聞いて `/se-request` で要望にする。
- 配信元のリポジトリ（`~/projects/sharpen`、`~/projects/brain-harness`）と cerebellum（`~/workspace/indie-development/cerebellum`）は読むだけにする。second-brain の共用の `inbox_post.py` は変えない。
- `NEXUS_implementation_handoff/` は本人の資料なので変えない（`.DS_Store` はコミットしない）。
- Mac mini の Tailscale Serve の設定（cerebellum などの入口）は、本人の許しなしに変えない。
- 外向きの送信（push、PR、外部サービスへの投稿）は本人に確かめてから行う。

## 機械事実（handoff_facts.sh が 2026-11-24 20:23 JST に採取・手で直さない）

- 作業ディレクトリ: `/Users/orion/workspace/indie-development/nexus`
- 採取時刻: 2026-11-24 20:23 JST
- 実行者: orion@orionnoMac-mini
- codex: codex-cli 0.163.0
- git: リポジトリ内（root `/Users/orion/workspace/indie-development/nexus`・ブランチ `main`）

### 直近コミット（5件）
```
56fd2f2 基本設計の書類一式と画面の試作を追加
c751cf0 要件定義の書類一式（docs/upstream の RD・X、版 1.0）と依頼の資料を追加
ae886c9 Add README
```

### 未コミットの変更（git status --short）
```
 M docs/upstream/bd/BD-01-architecture.md
 M docs/upstream/bd/BD-02-functional-spec.md
 M docs/upstream/bd/BD-03-screen-design.md
 M docs/upstream/bd/BD-06-external-interface.md
 M docs/upstream/bd/BD-07-logical-data-design.md
 M docs/upstream/bd/BD-09-common-design.md
 M docs/upstream/bd/BD-10-security-design.md
 M docs/upstream/bd/BD-11-operation-design.md
 M docs/upstream/bd/BD-13-prototype.md
 M docs/upstream/rd/RD-05-functional-requirements.md
 M docs/upstream/rd/RD-06-use-case-spec.md
 M docs/upstream/rd/RD-07-screen-requirements.md
 M docs/upstream/rd/RD-16-requirements-register.md
 M docs/upstream/x/X-01-traceability-matrix.md
 M docs/upstream/x/X-02-design-decision-record.md
 M docs/upstream/x/X-04-issue-change-register.md
 M docs/upstream/x/X-05-review-and-phase-gate-record.md
 M docs/upstream/x/X-07-project-standards.md
 M handoff.md
 M prototype/app/home.css
 M prototype/app/page.tsx
?? NEXUS_implementation_handoff/.DS_Store
```

### 差分の量（git diff --stat・HEAD比）
```
 docs/upstream/bd/BD-03-screen-design.md            |  61 ++++----
 docs/upstream/bd/BD-06-external-interface.md       |   3 +-
 docs/upstream/bd/BD-07-logical-data-design.md      |   3 +-
 docs/upstream/bd/BD-09-common-design.md            |  18 ++-
 docs/upstream/bd/BD-10-security-design.md          |   3 +-
 docs/upstream/bd/BD-11-operation-design.md         |   3 +-
 docs/upstream/bd/BD-13-prototype.md                |  44 +++---
 docs/upstream/rd/RD-05-functional-requirements.md  |   7 +-
 docs/upstream/rd/RD-06-use-case-spec.md            |   7 +-
 docs/upstream/rd/RD-07-screen-requirements.md      |   7 +-
 docs/upstream/rd/RD-16-requirements-register.md    |   2 +-
 docs/upstream/x/X-01-traceability-matrix.md        |   5 +-
 docs/upstream/x/X-02-design-decision-record.md     |  20 ++-
 docs/upstream/x/X-04-issue-change-register.md      |   1 +
 .../x/X-05-review-and-phase-gate-record.md         | 166 ++++++++++++++++++++-
 docs/upstream/x/X-07-project-standards.md          |  13 +-
 handoff.md                                         |  81 ++++------
 prototype/app/home.css                             |  16 +-
 prototype/app/page.tsx                             |  21 +--
 21 files changed, 342 insertions(+), 151 deletions(-)
```

### 最近触ったファイル（24時間以内・上位20・.git と node_modules 除く）
```
prototype/app/home.css
prototype/app/inbox/page.tsx
prototype/app/galaxy/page.tsx
prototype/app/english/page.tsx
prototype/app/sse-test/page.tsx
prototype/app/layout.tsx
prototype/app/api/sse/route.ts
prototype/app/page.tsx
prototype/app/globals.css
prototype/next.config.mjs
prototype/.next/types/app/inbox/page.ts
prototype/.next/types/app/galaxy/page.ts
prototype/.next/types/app/english/page.ts
prototype/.next/types/app/page.ts
prototype/.next/types/app/sse-test/page.ts
prototype/.next/types/app/layout.ts
prototype/.next/types/app/api/sse/route.ts
prototype/.next/types/cache-life.d.ts
prototype/.next/types/package.json
prototype/.next/types/routes.d.ts
```
