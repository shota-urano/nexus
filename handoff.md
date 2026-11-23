# 引き継ぎ書（handoff）

> 対話セッションから次の Claude Code セッションへの業務引き継ぎ（2026-11-23）。読む側は「次の一手」から始め、「触ってはいけないもの」を変更しない。
> 5節はセッション（LLM）が書く。機械事実の節は scripts が採取したもので、手で直さない。

## 現在地

NEXUS（AI から届く情報を読み・探し・AI に質問する個人用 PWA）を、software-engineer ハーネスの `/se` で上流工程から進めている。依頼の文は `NEXUS_implementation_handoff/NEXUS_IMPLEMENTATION_HANDOFF.md`。要件定義の書類一式を `docs/upstream/rd/`（RD-01、03〜07、09〜13、15、16）と `docs/upstream/x/`（X-01〜X-07）に書き終え、2026-11-23 に本人が要件定義の完了判定（`docs/upstream/x/X-05-review-and-phase-gate-record.md` の PG01）を「条件付きで進める」とした。書類は全て版 1.0。REQ-001〜REQ-029 と ADR-001〜ADR-005 は承認済み。dscheck の lint・glossary・chain・gate は全て通っている（2026-11-23 に確認）。基本設計はまだ1冊も書いていない。コードも無い。全て未コミット。

## 確定済みの判断

- 新規の案件として進める（X-02 ADR-003）。`setool status` は README があるので「既存」と出すが、本人が新規と決めた。
- 書類は /se の形（`docs/upstream/`）。依頼の文の求める architecture.md などは作らない（本人 2026-11-23）。
- X-06 の採否は承認済み（見直し3まで）。省く書類は RD-08、RD-14、RD-17、BD-04、BD-08、BD-12、BD-14、DD-07、DD-08。RD-02 は RD-01 の節に、BD-05 は BD-02 のバッチの節にまとめる。
- 未決事項 Q-001〜Q-065 は全て本人が答えた（答えは `docs/upstream/x/X-04-issue-change-register.md`）。蒸し返さない。主なもの: 利用者は本人だけ、Phase 4 は範囲外、配信元は brain-harness（ニュース）と sharpen（英語）で送り先だけ NEXUS に改修、cerebellum への送信は3日間両方に送った後にやめる、英語の教材は read.json を NEXUS の表示部品で見せる（iframe は作らない。ADR-001）。
- AI は `claude -p` を本人のサブスクリプションで動かす（Q-040、ADR-005）。従量の課金を足さないため（Q-008）。
- AI の項目の判定は、書いた AI（Claude）と別のモデル（Codex）が行う。Codex が使えないときは待つ（05-ai-authoring-rules 5章）。要件定義の判定は RV01〜RV05 で済んでいる。

## 残タスク

1. 基本設計を書く。書く順番は `cd /Users/orion/workspace/harnesses/software-engineer/tools/dev-standard-check && python3 -m dscheck order --phase bd --x06 /Users/orion/workspace/indie-development/nexus/docs/upstream/x/X-06-tailoring-record.md` が出す。完了条件: X-06 で採った BD の書類が全て `docs/upstream/bd/` にあり、Q を本人に聞いて埋め、Codex の判定（X-05 RV06 以降）と本人の完了判定（PG02）が済む。
2. 基本設計の中で、PG01 の条件を守る。Q-066 に左右される範囲（REQ-002、011、013、014、023、024、029、FN-002、015、016、IF-004、NFR-002、009、016、017、019、029）は書いてよいが、Q-066 が決まるまで仕様書を `confirmed` の候補にしない。
3. 詳細設計と仕様書（`docs/specs/`）を書き、本人が仕様書を確定する。その後 `/se develop`。
4. 本人の作業: Phase 3 の前に、`claude -p` をサブスクリプションで NEXUS のサーバから動かす使い方を Anthropic に確かめる（Q-066、RD-15 AC36）。結果を X-04 Q-066 に書く。
5. 本人にまだ答えをもらっていないこと: (a) ここまでの書類のコミット（main にいるので、するならブランチを切る）。(b) README だけで「既存」と判定される件をハーネスへの要望（`/se-request`）に足すか。

## 次の一手

本人に (a) コミットと (b) ハーネスへの要望の2つを聞く。その後、`/se` の手順どおり `cd /Users/orion/workspace/harnesses/software-engineer/tools/se && python3 -m setool status --repo /Users/orion/workspace/indie-development/nexus` を実行し、次にやること（BD-01 方式設計書）を示して「始めますか」と聞く。始めるときは `/Users/orion/workspace/harnesses/software-engineer/docs/dev-standard/procedures/AP-BD-basic-design.md` と `templates/bd/BD-01-architecture.md`、例 `docs/trial/meeting-room/bd/BD-01-architecture.md` を読み、上の order の順に書く。BD-01 では ADR-005（claude -p）と依頼 3章の推奨（TypeScript、Tailwind、Motion、PostgreSQL など。未確定）を、推測で決めずに本人に聞く。

## 触ってはいけないもの

- 承認済みの書類（版 1.0）の中身を、変更要求（CR）を起こさずに直さない。要件を変えるときは X-04 に CR を起こして本人の承認を得る。
- X-05 の判定の記録（RV01〜RV05、PG01）を書き換えない。
- ハーネス（`/Users/orion/workspace/harnesses/software-engineer`）を直さない。直したいことは本人に聞いて `/se-request` で要望にする。
- 配信元のリポジトリ（`~/projects/sharpen`、`~/projects/brain-harness`）と cerebellum（`~/workspace/indie-development/cerebellum`）は、基本設計の間は読むだけにする。second-brain の共用の `inbox_post.py` は変えない。
- `NEXUS_implementation_handoff/` は本人の資料なので変えない。

## 機械事実（handoff_facts.sh が 2026-11-23 23:16 JST に採取・手で直さない）

- 作業ディレクトリ: `/Users/orion/workspace/indie-development/nexus`
- 採取時刻: 2026-11-23 23:16 JST
- 実行者: orion@orionnoMac-mini
- codex: codex-cli 0.163.0
- git: リポジトリ内（root `/Users/orion/workspace/indie-development/nexus`・ブランチ `main`）

### 直近コミット（5件）
```
ae886c9 Add README
```

### 未コミットの変更（git status --short）
```
?? NEXUS_implementation_handoff/
?? docs/
?? handoff.md
```

### 差分の量（git diff --stat・HEAD比）
```
```

### 最近触ったファイル（24時間以内・上位20・.git と node_modules 除く）
```
docs/upstream/rd/RD-12-security-requirements.md
docs/upstream/rd/RD-13-operation-requirements.md
docs/upstream/rd/RD-05-functional-requirements.md
docs/upstream/rd/RD-04-use-case-list.md
docs/upstream/rd/RD-03-business-requirements.md
docs/upstream/rd/RD-06-use-case-spec.md
docs/upstream/rd/RD-16-requirements-register.md
docs/upstream/rd/RD-07-screen-requirements.md
docs/upstream/rd/RD-15-acceptance-criteria.md
docs/upstream/rd/RD-10-external-interface-requirements.md
docs/upstream/rd/RD-09-data-requirements.md
docs/upstream/rd/RD-11-non-functional-requirements.md
docs/upstream/rd/RD-01-vision.md
docs/upstream/x/X-04-issue-change-register.md
docs/upstream/x/X-07-project-standards.md
docs/upstream/x/X-03-glossary.md
docs/upstream/x/X-01-traceability-matrix.md
docs/upstream/x/X-05-review-and-phase-gate-record.md
docs/upstream/x/X-02-design-decision-record.md
docs/upstream/x/X-06-tailoring-record.md
```
