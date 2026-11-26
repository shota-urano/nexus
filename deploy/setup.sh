#!/bin/sh
# NEXUS の本番の構築のスクリプト（DD-09 4章 手順 3。BD-11 OP01 の中で本人が動かす）。
#   sh deploy/setup.sh
# 1. ~/Library/Application Support/nexus/（0700）、その中の ai-workdir/（0700）、~/Library/Logs/nexus/（0700）を作る。
# 2. deploy/ の雛形の __HOME__ を本人のホームの絶対の道に直し、次に置く。
#    - env → ~/Library/Application Support/nexus/env（0600）。既にあれば上書きしない（本人が書き込んだ値を残す）。
#    - claude-settings.json → ~/Library/Application Support/nexus/claude-settings.json（0600）。
#      `~` は permissions の「ホームからの道」の書き方なので、直さずにそのまま置く（DD-09 2.5）。
#    - launchd の雛形4つ → ~/Library/LaunchAgents/。__REPO__（このリポジトリ）と __NODE__（Node.js の絶対の道）も書き込む。
# launchd に読み込ませるのは手順 5 で、このスクリプトはしない。
# 別のディスクの nexus-backup（手順 4）と、__TAILNET__、__BACKUP_VOLUME__ の書き込みは、本人が OP01 で行う。
#
# Node.js の道は、NEXUS_NODE_BIN があればそれ、無ければ Homebrew の node@<番号> の一番大きい番号、
# それも無ければ PATH の node を使う（DD-09 2.1）。見つからなければ launchd の設定は置かずに知らせる。
set -eu
# 親のフォルダ（~/Library/LaunchAgents など）はふだんの権限で作り、置くファイルだけを本人だけが読めるようにする。
umask 022

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_DIR=$(dirname "$DEPLOY_DIR")

: "${HOME:?HOME が無い}"
case "$HOME" in
/*) ;;
*)
  echo "HOME は絶対の道にする: $HOME" >&2
  exit 1
  ;;
esac

DATA_DIR="$HOME/Library/Application Support/nexus"
WORK_DIR="$DATA_DIR/ai-workdir"
LOG_DIR="$HOME/Library/Logs/nexus"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LABELS="jp.uslab.nexus.web jp.uslab.nexus.runner jp.uslab.nexus.backup jp.uslab.nexus.purge"

# sed の置き換えの文字列に使えるよう、\ と & と区切りの | を逃がす。
sed_escape() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}
# plist の文字列に使えるよう、XML の & < > を逃がしてから sed 用に逃がす。
xml_sed_escape() {
  sed_escape "$(printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
}

# 1. フォルダ
for dir in "$DATA_DIR" "$WORK_DIR" "$LOG_DIR"; do
  mkdir -p "$dir"
  chmod 0700 "$dir"
done
echo "フォルダを作った（0700）: $DATA_DIR、$WORK_DIR、$LOG_DIR"

# 2. env
if [ -e "$DATA_DIR/env" ]; then
  echo "env は既にあるので上書きしない: $DATA_DIR/env"
else
  home=$(sed_escape "$HOME")
  (umask 077 && sed -e "s|__HOME__|$home|g" "$DEPLOY_DIR/env" >"$DATA_DIR/env.tmp")
  chmod 0600 "$DATA_DIR/env.tmp"
  mv "$DATA_DIR/env.tmp" "$DATA_DIR/env"
  echo "env を置いた（0600）: $DATA_DIR/env"
fi

# 2. claude-settings.json
(umask 077 && cp "$DEPLOY_DIR/claude-settings.json" "$DATA_DIR/claude-settings.json.tmp")
chmod 0600 "$DATA_DIR/claude-settings.json.tmp"
mv "$DATA_DIR/claude-settings.json.tmp" "$DATA_DIR/claude-settings.json"
echo "claude-settings.json を置いた（0600）: $DATA_DIR/claude-settings.json"

# 2. launchd の設定
node_bin=${NEXUS_NODE_BIN:-}
if [ -z "$node_bin" ]; then
  for candidate in $(ls -d /opt/homebrew/opt/node@*/bin/node 2>/dev/null | sort -t@ -k2 -n -r); do
    if [ -x "$candidate" ]; then
      node_bin=$candidate
      break
    fi
  done
fi
if [ -z "$node_bin" ]; then
  node_bin=$(command -v node || true)
fi
case "$node_bin" in
/*) ;;
*) node_bin= ;;
esac

if [ -z "$node_bin" ] || [ ! -x "$node_bin" ]; then
  echo "Node.js が見つからないので、launchd の設定は置かなかった。NEXUS_NODE_BIN に Node.js の絶対の道を入れて、もう一度動かす。" >&2
else
  mkdir -p "$AGENTS_DIR"
  home=$(xml_sed_escape "$HOME")
  repo=$(xml_sed_escape "$REPO_DIR")
  node=$(xml_sed_escape "$node_bin")
  for label in $LABELS; do
    target="$AGENTS_DIR/$label.plist"
    sed -e "s|__HOME__|$home|g" -e "s|__REPO__|$repo|g" -e "s|__NODE__|$node|g" \
      "$DEPLOY_DIR/$label.plist" >"$target.tmp"
    chmod 0644 "$target.tmp"
    mv "$target.tmp" "$target"
  done
  echo "launchd の設定を置いた（Node.js: $node_bin）: $AGENTS_DIR/jp.uslab.nexus.*.plist"
fi

echo "残り: __TAILNET__ と __BACKUP_VOLUME__ を env と launchd の設定に書き込み、別のディスクに nexus-backup（0700）を作る（DD-09 4章 手順 4。OP01）。"
