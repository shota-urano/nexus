# 仮の verify。コードがまだ無いので、0件のテストの結果ファイルだけを書き出す。
# 本物の verify は 01-foundation.md の最初の実装単位で置き換える。
.PHONY: verify
verify:
	@mkdir -p reports
	@printf '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="placeholder" tests="0" failures="0" errors="0" skipped="0"></testsuite>\n' > reports/junit.xml
