/* 外部（収益先）への離脱クリックをGA4で測る。2026-09-02 新設。
 *
 * 背景：勝負ラボは /betting/ と /koei/ に楽天書籍リンクを計12本置いているが、
 * クリックが1件も測れていなかった（宅建GYM・方言ラボで同日に見つかったのと同じ穴）。
 * 楽天アフィリのレポートは計測ID未登録のためサイト別・記事別の内訳を返さないので、
 * 「この本の枠は読まれているのか」を知る手段がGA4イベント以外に存在しない。
 *
 * 送るイベント： aff_click { network, item_id, from_page }
 *                note_click { note_id, from_page }
 *
 * ※ シミュレータの実行イベント sim_run{area,mode,system,game,trials,from_page} は
 *   ここではなく /betting/app.js と /koei/app.js の中で送っている（設定値を持つのが
 *   そちらのため）。3サイトでイベント名を揃えてあるので月次で横に並べて読める。
 *
 * 🔴 このファイルにAdSenseコードを足さないこと（勝負ラボは隔離ドメイン）。
 * gtag が未ロード（広告ブロッカー等）でも例外を投げない。
 */
(function () {
  function send(name, params) {
    try {
      if (window.gtag) window.gtag("event", name, params);
    } catch (e) {
      /* 計測失敗でUIを壊さない */
    }
  }
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      var from = location.pathname;
      if (href.indexOf("hb.afl.rakuten.co.jp") > -1) {
        var r = href.match(/item\.rakuten\.co\.jp%2Fbook%2F(\d+)/i);
        send("aff_click", {
          network: "rakuten",
          item_id: r ? r[1] : "unknown",
          from_page: from
        });
        return;
      }
      if (href.indexOf("note.com/") > -1) {
        var k = href.match(/\/n\/(n[0-9a-z]+)/);
        send("note_click", { note_id: k ? k[1] : "unknown", from_page: from });
      }
    },
    true
  );
})();
