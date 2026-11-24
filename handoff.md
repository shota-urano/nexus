# 引き継ぎ書（handoff）

> 対話セッションから次の Claude Code セッション（または Codex）への業務引き継ぎ（2026-11-24）。読む側は「次の一手」から始め、「触ってはいけないもの」を変更しない。
> 5節はセッション（LLM）が書く。機械事実の節は scripts が採取したもので、手で直さない。

## 現在地

NEXUS（AI から届く情報を読み・探し・AI に質問する個人用 PWA）を、software-engineer ハーネスの `/se` で上流工程から進めている。依頼の文は `NEXUS_implementation_handoff/NEXUS_IMPLEMENTATION_HANDOFF.md`。要件定義（X-05 PG01）と基本設計（X-05 PG02）を、どちらも「条件付きで進める」で終えた（2026-11-24）。基本設計の書類 `docs/upstream/bd/` の BD-01、02、03、06、07、09、10、11、13 は版 1.0。要件定義の書類は変更要求 CR-001〜CR-004 で直し、RD-03、04、09、10、12、15、16 が 1.1、RD-05、06、07 が 1.2。横断の X-01〜X-04、X-07 は 1.1。機械の点検（dscheck の lint・trigger・glossary・confirm・chain・gate）は全て通っている（2026-11-24 に確かめた）。`setool status` の次にやることは「詳細設計。未決事項が2件あるので先に聞く。次は DD-01」。詳細設計の書類はまだ1冊も無い。アプリの本番のコードは無い。画面の試作は `prototype/`（本番に使わない。BD-13）にあり、試作の Tailscale Serve の入口（:8443）とサーバは止めた。PG02 の記録、BD の 1.0 化、CR-004 の反映はまだコミットしていない（最後のコミットは 56fd2f2）。

## 確定済みの判断

- 条件付きの条件は、解いてから次の工程の書類を書く（2026-11-24 本人「条件付きは解決した上で進めたい」）。詳細設計の書類は、Q-066 と Q-082 を解いてから書く。
- 技術と方式は X-02 ADR-006〜ADR-015 で全て承認済み（2026-11-24）。TypeScript、Next.js、Tailwind、Motion、SQLite、Web サーバと AI Runner の2つのプロセスを launchd で動かす、Tailscale Service の専用の名前、登録コードと端末の鍵、AI で記事の関係を判定、DB の待ち行列、SSE、ニュースの図は React Flow。蒸し返さない。
- 未決事項 Q-001〜Q-081 は Q-066 のほか全て決定（X-04）。変更要求 CR-001〜CR-004 は全て反映済み。
- UI の画像は Codex（image-gen スキル）に作らせる。見た目の参考は `NEXUS_implementation_handoff/references/` の参考の画像とモック HTML。要件に無い部品（宣伝文、検索と設定、学習連続、ワークスペース、下の帯）は入れない。ホーム右上の惑星の飾りは本人の希望で入れる（2026-11-24 本人）。
- AI の項目の判定は、書いた AI（Claude）と別のモデル（Codex。`codex exec -s read-only`）が行う。判定の記録は X-05 に原文を写す。点検を通すために記録の言葉を AI だけで書き換えない（2026-11-24。書き換えるときは本人に確かめる）。
- 命名とコーディングの決まりは X-07 2章・3章（snake_case の DB、camelCase と PascalCase の TypeScript、kebab-case のファイル、Prettier と ESLint）。

## 残タスク

1. Q-082 を解く: Claude Code の CLI の設定で、使えるツールをウェブの検索とページの読み取りだけにし、ファイルの読み書きとコマンドの実行を許さず、ページの読み取りで Mac mini の中（localhost、127.0.0.1、Mac mini の名前）と Tailscale の中の宛先を読ませないことができるかを、公式の文書（Claude Code の headless、settings、permissions の頁など）で確かめる。結果と出どころを本人に示し、本人が確かめたら X-04 Q-082 を決定にし、X-05 に PG02 の条件2が解けたと記録する。完了条件: X-04 Q-082 の状態が「決定」で、答えに出どころの URL がある。
2. Q-066 を解く: 本人のサブスクリプションで `claude -p` を NEXUS のサーバから動かす使い方を Anthropic が認めるかを、本人が確かめる（本人の作業。AI は確かめ方の案と、公式の文書で分かることだけを示す）。結果を X-04 Q-066 に書き、認められなければ Messages API に替える変更（ADR、NFR-009 と Q-008 の見直し）を起こす。完了条件: X-04 Q-066 が「決定」で、X-05 に PG01・PG02 の条件1が解けたと記録がある。
3. 本人にコミットを聞く（PG02 の記録、BD の 1.0 化、CR-004 の反映、Q の決定）。完了条件: 本人の答えのとおりに main へコミットしたか、しないと決まった。
4. 詳細設計の書類の採否を見直す: `dscheck tailor` で案を作り直し、本人に承認を求める（AP-BD 1.2、GT-BD G15）。完了条件: X-06 の DD の採否に本人の承認が書かれている。
5. 詳細設計を書く（`dscheck order --phase dd` の順。最初は DD-01）。手順は `/Users/orion/workspace/harnesses/software-engineer/docs/dev-standard/procedures/` の AP-DD。完了条件: 詳細設計の完了判定（PG03）まで。その後、仕様書 `docs/specs/` を書き、本人が確定し、`/se develop`。

## 次の一手

まず `/se` を打って `setool status` を確かめる。次に残タスク1（Q-082）に取りかかる。読むもの: `docs/upstream/x/X-04-issue-change-register.md` の Q-082 の行、`docs/upstream/bd/BD-10-security-design.md` の 3章 T03・T16 と 4章 ネットワーク、`docs/upstream/bd/BD-01-architecture.md` の 7章 NFR-016。Claude Code の公式の文書を読み、「使えるツールを限る設定（許可・拒否の規則）」「ページの読み取り（WebFetch）の宛先を限れるか」「ファイルとコマンドのツールを止められるか」を、引用と URL 付きでまとめて本人に示す。同時に、本人に Q-066（Anthropic への確認）の進み具合を聞く。

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
