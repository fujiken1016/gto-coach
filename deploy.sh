#!/bin/zsh
# GTO Coach デプロイスクリプト
# 本番＝ https://gto-coach-jp.vercel.app （アプリ本体・previewデプロイにaliasを固定）
# 旧URL https://poker-coach-gamma.vercel.app は移転告知（productionデプロイ）— 触らない
export PATH=/Users/fujiken/.local/node/bin:$PATH
DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$DIR/index.html" "$DIR"/privacy.html "$DIR"/disclaimer.html "$DIR"/about.html "$DIR"/contact.html "$DIR/deploy/" 2>/dev/null
cp "$DIR/index.html" /Users/fujiken/.local/share/poker-trainer/index.html 2>/dev/null
cd "$DIR/deploy"
URL=$(vercel deploy --yes 2>/dev/null | grep -oE 'https://poker-coach-[a-z0-9]+-fujiken\.vercel\.app' | head -1)
echo "deployed(preview): $URL"
vercel alias set "$URL" gto-coach-jp.vercel.app 2>&1 | tail -1
echo "本番URL: https://gto-coach-jp.vercel.app"
