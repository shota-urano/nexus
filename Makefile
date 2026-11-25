# 検証のコマンド（DD-09 5章）。外へ通信しない。
# 道具は node_modules/.bin から直に呼ぶ（npx による取り寄せを起こさないため）。
BIN := ./node_modules/.bin

# Redocly CLI の利用状況の送信と、npm の置き場所への新しい版の問い合わせを止める。
export REDOCLY_TELEMETRY := off
export REDOCLY_SUPPRESS_UPDATE_NOTICE := true
# Next.js の利用状況の送信を止める。
export NEXT_TELEMETRY_DISABLED := 1

.PHONY: verify

# 次の5つの手順をこの順に動かす。どれかが失敗したら、そこで 0 でない終了コードで終わる。
# 1. Prettier の確かめ 2. ESLint 3. 型の確かめ 4. Redocly CLI の lint 5. Vitest
verify:
	$(BIN)/prettier --check .
	$(BIN)/eslint .
	$(BIN)/tsc --noEmit
	$(BIN)/redocly lint
	@mkdir -p reports
	$(BIN)/vitest run
