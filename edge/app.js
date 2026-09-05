/* 還元率ラボ（/edge/）— 期待値の比較計算機
   現金は一切扱わない。表示される「円」はすべてシミュレーション上の数値。 */
(function () {
  'use strict';

  // 控除率（小数）。値の根拠は index.html の本文に明記してある。
  // 公営競技は「法定下限」から導いた控除率の上限値であり、実際の値ではない点に注意。
  var GAMES = [
    { id: 'bj',        name: 'ブラックジャック（ベーシック戦略・参考値）', edge: 0.005 },
    { id: 'bacc_b',    name: 'バカラ バンカー（文献値）',                  edge: 0.0106 },
    { id: 'bacc_p',    name: 'バカラ プレイヤー（文献値）',                edge: 0.0123 },
    { id: 'roul_lp',   name: 'ルーレット 0のみ＋ラ・パルタージュ',         edge: 0.013514 },
    { id: 'craps',     name: 'クラップス パスライン',                      edge: 0.014141 },
    { id: 'roul_1z',   name: 'ルーレット 0のみ（37マス）',                 edge: 0.027027 },
    { id: 'sicbo',     name: 'シックボー 大／小',                          edge: 0.027778 },
    { id: 'roul_2z',   name: 'ルーレット 0と00（38マス）',                 edge: 0.052632 },
    { id: 'bacc_t',    name: 'バカラ タイ 8倍（文献値）',                  edge: 0.1436 },
    { id: 'jra_win',   name: '中央競馬 単勝・複勝（JRA公表 80%）',         edge: 0.20 },
    { id: 'kyotei',    name: '競艇（法定下限75%）',                        edge: 0.25 },
    { id: 'jra_3t',    name: '中央競馬 3連単（JRA公表 72.5%）',            edge: 0.275 },
    { id: 'keirin',    name: '競輪（法定下限70%）',                        edge: 0.30 },
    { id: 'auto',      name: 'オートレース（法定下限70%）',                edge: 0.30 },
    { id: 'takarakuji',name: '宝くじ（法定上限50%）',                      edge: 0.50 }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var gA = $('gA'), gB = $('gB'), out = $('out'), note = $('note');

  GAMES.forEach(function (g) {
    [gA, gB].forEach(function (sel) {
      var o = document.createElement('option');
      o.value = g.id; o.textContent = g.name;
      sel.appendChild(o);
    });
  });
  gA.value = 'roul_2z';
  gB.value = 'jra_win';

  function byId(id) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
    return GAMES[0];
  }
  function yen(v) { return Math.round(v).toLocaleString('ja-JP') + '円'; }

  function calcOne(g, cap, bet, n) {
    var total = bet * n;                 // 賭けた総額
    var loss = total * g.edge;           // E[損失] = 控除率 × 賭けた総額
    var left = cap - loss;               // 期待残高
    // 資金が半分になるまでの回数： bet × k × edge = cap / 2
    var half = g.edge > 0 ? Math.ceil(cap / (2 * bet * g.edge)) : Infinity;
    var zero = g.edge > 0 ? Math.ceil(cap / (bet * g.edge)) : Infinity;
    return { total: total, loss: loss, left: left, half: half, zero: zero };
  }

  function render() {
    var cap = Math.max(1000, Number($('cap').value) || 100000);
    var bet = Math.max(10, Number($('bet').value) || 1000);
    var n   = Math.max(1, Number($('n').value) || 100);
    var a = byId(gA.value), b = byId(gB.value);
    var ra = calcOne(a, cap, bet, n), rb = calcOne(b, cap, bet, n);
    var worst = Math.max(ra.loss, rb.loss) || 1;

    function block(g, r, cls) {
      var pct = Math.min(100, (r.loss / worst) * 100);
      return '<div class="kv"><span>' + g.name + '</span><b>控除率 ' + (g.edge * 100).toFixed(2) + '%</b></div>' +
        '<div class="bar' + cls + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div class="kv"><span>賭けた総額</span><b>' + yen(r.total) + '</b></div>' +
        '<div class="kv"><span>期待損失</span><b>' + yen(r.loss) + '</b></div>' +
        '<div class="kv"><span>' + n + '回後の期待残高</span><b>' + yen(r.left) + '</b></div>' +
        '<div class="kv"><span>資金が半分になる回数（期待値）</span><b>' + r.half.toLocaleString('ja-JP') + '回</b></div>' +
        '<div class="kv"><span>資金が尽きる回数（期待値）</span><b>' + r.zero.toLocaleString('ja-JP') + '回</b></div>';
    }

    var diff = Math.abs(ra.loss - rb.loss);
    var slower = ra.loss < rb.loss ? a : b;

    out.innerHTML =
      block(a, ra, '') +
      '<div style="height:14px"></div>' +
      block(b, rb, ' b2') +
      '<div style="height:14px"></div>' +
      '<div class="kv"><span>同じ条件での期待損失の差</span><b>' + yen(diff) + '</b></div>' +
      '<div class="kv"><span>減るのが遅いのは</span><b>' + slower.name + '</b></div>';
    out.hidden = false;
    note.hidden = false;

    if (typeof gtag === 'function') {
      gtag('event', 'sim_run', {
        area: 'edge', mode: 'compare',
        game: a.id + '_vs_' + b.id, trials: n, from_page: '/edge/'
      });
    }
  }

  $('run').addEventListener('click', render);
})();
