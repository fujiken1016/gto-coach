// 運用ドキュメント・設定ファイルを公開URLから遮断する（Cloudflare Pages Functions）
//
// なぜ middleware か：リポジトリ直下＝公開ディレクトリなので運用ドキュメントがURLで読めてしまう。
// `_headers` の `X-Robots-Tag: noindex` は**検索避けであって非公開ではない**（URLを知れば誰でも読める）。
// `_redirects` の 404 化は CF Pages では**実在ファイルに勝てない**（静的アセットが優先・2026-08-30 実測）。
// Functions は静的アセットより先に評価されるため、ここでだけ確実に遮断できる。
//
// ⚠️ 列挙した以外のパスは context.next() でそのまま静的配信する（サイト本体は一切変えない）。
// ⚠️ `.md` は「配信する意図のあるURLが1本も無い」ため拡張子で一括遮断。
//    robots.txt / ads.txt / sitemap.xml / manifest.json を巻き込まないよう、他は明示リストのみ。

const DENY = new Set([
  "/.gitignore",
]);

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (path.toLowerCase().endsWith(".md") || DENY.has(path)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  return context.next();
}
