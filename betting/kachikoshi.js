/* ============================================================================
   勝負ラボ ベッティングシステム検証室 — 勝ち越し確率・損益の幅の計算機（J427）
   ---------------------------------------------------------------------------
   - エンジン（二項分布の厳密計算）と UI を1ファイルに持つ。ビルドなし。
   - Node からも require できる（UI は document があるときだけ動く）。
   - 非同期処理なし。計算ボタンで同期的に1回だけ計算する。
   - #selftest を付けて開くと、列挙・既知値との照合による自己テストが走る。
   - 🔴 現金・賭け金は扱わない。単位は「1回の賭け金◯回分」。AdSense を足さないこと（隔離ドメイン）。
   - モデル：1回の賭けは、確率 p で +b（配当 b:1）、確率 1−p で −1（賭け金を失う）。
            n回賭けたときの収支 = (b+1)·W − n   （W = 勝った回数 ~ 二項分布）
   ========================================================================= */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ エンジン */

  // 勝った回数 W=0..n の確率（二項分布）。最頻値から漸化式で両側へ伸ばし、最後に合計1へそろえる
  // （n=100,000 でも桁あふれ・桁落ちしない）。
  function pmf(p, n) {
    var a = new Float64Array(n + 1), q = 1 - p, m, w, tot = 0, i;
    if (p <= 0) { a[0] = 1; return a; }
    if (p >= 1) { a[n] = 1; return a; }
    m = Math.min(n, Math.floor((n + 1) * p));
    a[m] = 1;
    for (w = m; w < n; w++) a[w + 1] = a[w] * ((n - w) / (w + 1)) * (p / q);
    for (w = m; w > 0; w--) a[w - 1] = a[w] * (w / (n - w + 1)) * (q / p);
    for (i = 0; i <= n; i++) tot += a[i];
    for (i = 0; i <= n; i++) a[i] /= tot;
    return a;
  }

  var EPS = 1e-9;
  // 収支 (b+1)W − n ≥ t を満たす最小の W
  function minWins(b, n, t) {
    var w = Math.ceil((t + n) / (b + 1) - EPS);
    return Math.max(0, w);
  }
  // 収支 ≤ t を満たす最大の W（無ければ -1）
  function maxWins(b, n, t) {
    var w = Math.floor((t + n) / (b + 1) + EPS);
    return Math.min(n, w);
  }
  function sumFrom(a, lo) { var s = 0, i; for (i = a.length - 1; i >= lo && i >= 0; i--) s += a[i]; return s > 1 ? 1 : s; }
  function sumTo(a, hi) { var s = 0, i; for (i = 0; i <= hi && i < a.length; i++) s += a[i]; return s > 1 ? 1 : s; }

  // p＝1回に勝つ確率、b＝配当（勝てば +b・負ければ −1）、n＝回数。
  // t（収益の目標・賭け金何回分）と L（許容する損失・賭け金何回分）は任意。
  function analyze(p, b, n, t, L) {
    var a = pmf(p, n), q = 1 - p, k = b + 1, r = {};
    r.mean = n * (p * k - 1);
    r.sd = k * Math.sqrt(n * p * q);
    r.perBet = p * k - 1;                                // 1回あたりの期待収支（＝−控除率）
    r.pWin = sumFrom(a, Math.floor(n / k + EPS) + 1);       // 収支 > 0
    r.pEven = sumFrom(a, minWins(b, n, 0));              // 収支 ≥ 0
    r.pTarget = (t === undefined || t === null) ? null : sumFrom(a, minWins(b, n, t));
    r.pLoss = (L === undefined || L === null) ? null : sumTo(a, maxWins(b, n, -L));
    r.q05 = quantileNet(a, k, n, 0.05);
    r.q50 = quantileNet(a, k, n, 0.50);
    r.q95 = quantileNet(a, k, n, 0.95);
    r.normWin = normalWin(r.mean, r.sd, k, n);
    return r;
  }

  // 収支の分位点：累積確率が x に達する最初の W の収支
  function quantileNet(a, k, n, x) {
    var s = 0, w;
    for (w = 0; w <= n; w++) { s += a[w]; if (s >= x - 1e-12) return k * w - n; }
    return k * n - n;
  }

  // 正規近似（連続性補正つき）での「収支 > 0」の確率。厳密値との差を見せるための比較用。
  function normalWin(mean, sd, k, n) {
    if (sd <= 0) return mean > 0 ? 1 : 0;
    var w0 = Math.floor(n / k + EPS);              // W ≤ w0 なら収支 ≤ 0
    var mu = mean / k + n / k;                     // E[W]
    var sg = sd / k;
    var z = (w0 + 0.5 - mu) / sg;
    return 1 - normCdf(z);
  }
  function normCdf(z) {                              // Abramowitz-Stegun 7.1.26（誤差 1.5e-7）
    var s = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + s * y);
  }

  var GAMES = {
    euro:  { name: 'ヨーロピアンルーレット 赤/黒（1:1）',      win: 18 / 37, pay: 1 },
    amer:  { name: 'アメリカンルーレット 赤/黒（1:1）',        win: 18 / 38, pay: 1 },
    eurod: { name: 'ヨーロピアンルーレット ダース（2:1）',     win: 12 / 37, pay: 2 },
    eurs:  { name: 'ヨーロピアンルーレット 1点賭け（35:1）',   win: 1 / 37,  pay: 35 },
    amers: { name: 'アメリカンルーレット 1点賭け（35:1）',     win: 1 / 38,  pay: 35 },
    coin:  { name: '公正なコイン（50%・1:1・控除率0）',        win: 0.5,     pay: 1 }
  };

  var api = { pmf: pmf, analyze: analyze, normalWin: normalWin, GAMES: GAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BetKachi = api;

  if (typeof document === 'undefined') return;

  /* ---------------------------------------------------------------- 表示 */
  var TRACK_OFF = (location.hash === '#selftest' || location.search.indexOf('selftest=1') >= 0);
  function track(name, params) {
    if (TRACK_OFF) return;
    try { if (window.gtag) window.gtag('event', name, params); } catch (e) { /* 計測失敗でUIを壊さない */ }
  }

  function fmtPct(x) {
    var v = x * 100;
    if (x <= 0) return '限りなく0%';
    if (x >= 0.99995) return '99.99%超';
    if (v >= 10) return v.toFixed(1) + '%';
    if (v >= 0.01) return v.toFixed(2) + '%';
    var e = v.toExponential(1).replace('e-', ' × 10⁻').replace(/⁻(\d+)/, function (m, d) {
      return '⁻' + d.split('').map(function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]; }).join('');
    });
    return e + '%';
  }
  function fmtU(x) {                                  // 賭け金◯回分（符号つき）
    var ax = Math.abs(x), v = ax >= 100 ? Math.round(x) : ax >= 1 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100;
    var s = Math.abs(v).toLocaleString('ja-JP');
    return (v > 0 ? '＋' : v < 0 ? '−' : '') + s;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(el, lo, hi, def) {
    var v = parseFloat(String(el.value).replace(/,/g, ''));
    if (!isFinite(v)) v = def;
    return Math.min(hi, Math.max(lo, v));
  }
  function stat(label, value, cls) {
    return '<div class="stat"><div class="v ' + (cls || '') + '">' + value + '</div><div class="l">' + label + '</div></div>';
  }
  function gameSelect(id) {
    var h = '<select id="' + id + '">';
    Object.keys(GAMES).forEach(function (k) { h += '<option value="' + k + '">' + esc(GAMES[k].name) + '</option>'; });
    return h + '<option value="custom">自分で入力（勝つ確率 % と配当）</option></select>';
  }
  function params(el) {
    var g = el.querySelector('#kc-game'), p, b;
    if (g.value === 'custom') { p = num(el.querySelector('#kc-p'), 0.01, 99.99, 48.65) / 100; b = num(el.querySelector('#kc-b'), 0.01, 1000, 1); }
    else { p = GAMES[g.value].win; b = GAMES[g.value].pay; }
    return { g: g.value, p: p, b: b, label: g.value === 'custom' ? '勝つ確率 ' + (p * 100).toFixed(2) + '%・配当 ' + b + ':1' : GAMES[g.value].name };
  }

  function mount(el) {
    el.innerHTML =
      '<div class="fields">' +
      '<div class="field"><label for="kc-game">ゲームと賭け方</label>' + gameSelect('kc-game') + '</div>' +
      '<div class="field" id="kc-cwrap" hidden><label for="kc-p">1回に勝つ確率（%）</label><input id="kc-p" type="number" inputmode="decimal" min="0.01" max="99.99" step="0.01" value="48.65"><span class="hint">0.01〜99.99</span>' +
      '<label for="kc-b">配当（勝つと賭け金の何倍もらえるか）</label><input id="kc-b" type="number" inputmode="decimal" min="0.01" max="1000" step="0.01" value="1"><span class="hint">1:1 なら 1、35:1 なら 35。負けると賭け金1回分を失う前提</span></div>' +
      '<div class="field"><label for="kc-n">賭ける回数</label><input id="kc-n" type="number" inputmode="numeric" min="1" max="100000" step="1" value="100"><span class="hint">1〜100,000 回。毎回同じ賭け金を同じ賭け方で</span></div>' +
      '<div class="field"><label for="kc-t">目標の収支（賭け金の何回分の儲けか）</label><input id="kc-t" type="number" inputmode="decimal" min="0" max="1000000" step="1" value="10"><span class="hint">「この儲け以上になる確率」を出します。0〜1,000,000</span></div>' +
      '<div class="field"><label for="kc-l">許容できる損失（賭け金の何回分か）</label><input id="kc-l" type="number" inputmode="decimal" min="0" max="1000000" step="1" value="20"><span class="hint">「この損失以上になる確率」を出します。0〜1,000,000</span></div>' +
      '</div>' +
      '<div class="btnrow"><button class="primary" id="kc-go" type="button">計算する</button></div>' +
      '<div id="kc-out" aria-live="polite"></div>';
    var g = el.querySelector('#kc-game'), cw = el.querySelector('#kc-cwrap');
    g.addEventListener('change', function () { cw.hidden = g.value !== 'custom'; });
    el.querySelector('#kc-go').addEventListener('click', function () { run(el); });
    run(el, true);
  }

  function run(el, initial) {
    var pr = params(el), p = pr.p, b = pr.b;
    var n = Math.round(num(el.querySelector('#kc-n'), 1, 100000, 100));
    var t = num(el.querySelector('#kc-t'), 0, 1e6, 10), L = num(el.querySelector('#kc-l'), 0, 1e6, 20);
    var out = el.querySelector('#kc-out');
    var r = analyze(p, b, n, t, L), edge = -r.perBet;
    var ns = [10, 50, 100, 500, 1000, 5000, 10000], rows = '', j, rr, nn;
    for (j = 0; j < ns.length; j++) {
      nn = ns[j]; rr = (nn === n) ? r : analyze(p, b, nn);
      rows += '<tr' + (nn === n ? ' class="hit"' : '') + '><td>' + nn.toLocaleString('ja-JP') + ' 回</td><td' + (rr.pWin < 0.2 ? ' class="bad"' : '') + '>' + fmtPct(rr.pWin) + '</td><td>' + fmtU(rr.mean) + '</td><td>' + fmtU(rr.q05) + ' 〜 ' + fmtU(rr.q95) + '</td></tr>';
    }
    out.innerHTML =
      '<div class="stats">' +
      stat(n.toLocaleString('ja-JP') + ' 回賭けて勝ち越す（収支がプラスで終わる）確率', fmtPct(r.pWin), r.pWin >= 0.5 ? 'pos' : 'neg') +
      stat('期待収支（賭け金の何回分か・平均）', fmtU(r.mean) + ' 回分') +
      stat('収支のばらつき（標準偏差）', '± ' + (r.sd >= 100 ? Math.round(r.sd).toLocaleString('ja-JP') : (Math.round(r.sd * 10) / 10)) + ' 回分') +
      stat('収支が ＋' + t.toLocaleString('ja-JP') + ' 回分以上になる確率', fmtPct(r.pTarget)) +
      stat('収支が −' + L.toLocaleString('ja-JP') + ' 回分以下（損失）になる確率', fmtPct(r.pLoss), r.pLoss >= 0.5 ? 'neg' : '') +
      stat('収支の幅（90%の場合に収まる範囲）', fmtU(r.q05) + ' 〜 ' + fmtU(r.q95)) +
      '</div>' +
      '<div class="msg ' + (r.pWin >= 0.5 ? 'done' : 'bust') + '"><b>' + esc(pr.label) + '</b>（控除率 ' + (edge * 100).toFixed(2) + '%）を毎回賭け金1回分ずつ ' + n.toLocaleString('ja-JP') + ' 回賭けると、' +
      '<b>プラスで終わる確率は ' + fmtPct(r.pWin) + '</b>、平均では ' + fmtU(r.mean) + ' 回分です。' +
      (edge > 0 ? '平均がマイナスでも、短い回数なら勝ち越すことは普通にあります。ただし回数を増やし続けると、この確率はいずれ下がっていきます。' : '期待値が0のゲームなので、勝ち越す確率はほぼ半々のままです。') + '</div>' +
      '<div class="tablebox"><table><thead><tr><th scope="col">賭ける回数</th><th scope="col">勝ち越す確率</th><th scope="col">期待収支</th><th scope="col">90%が収まる範囲</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="scrollhint">※ 表は横にスクロールできます。</div>' +
      '<p class="small">正規分布で近似した場合の「勝ち越す確率」は ' + fmtPct(r.normWin) + '（この計算機の厳密値は ' + fmtPct(r.pWin) + '）。当たりにくい賭け方ほど近似は外れます。</p>';
    if (!initial) track('calc_run', { area: 'betting', tool: 'kachikoshi', game: pr.g, trials: n, from_page: location.pathname });
  }

  /* ---------------------------------------------------------- 自己テスト */
  function selftest() {
    var res = [], fail = 0, a;
    function chk(name, x, y, tol) { var ok = Math.abs(x - y) <= tol; if (!ok) fail++; res.push((ok ? 'PASS ' : 'FAIL ') + name + '  実装=' + x.toPrecision(8) + '  期待=' + y.toPrecision(8)); }
    // 列挙で確かめた既知値
    chk('公正コイン n=2 で勝ち越し → 1/4', analyze(0.5, 1, 2).pWin, 0.25, 1e-12);
    chk('公正コイン n=2 で収支≥0 → 3/4', analyze(0.5, 1, 2).pEven, 0.75, 1e-12);
    chk('公正コイン n=3 で勝ち越し → 1/2', analyze(0.5, 1, 3).pWin, 0.5, 1e-12);
    chk('公正コイン n=10 で勝ち越し → 386/1024', analyze(0.5, 1, 10).pWin, 386 / 1024, 1e-12);
    chk('公正コイン n=10 で収支≥0 → 638/1024', analyze(0.5, 1, 10).pEven, 638 / 1024, 1e-12);
    chk('p=1/3・配当2:1・n=3 で勝ち越し → 7/27', analyze(1 / 3, 2, 3).pWin, 7 / 27, 1e-12);
    chk('p=1/3・配当2:1 は期待値0 → 期待収支 0', analyze(1 / 3, 2, 30).mean, 0, 1e-12);
    chk('欧州1点賭け n=1 の勝ち越し確率 → 1/37', analyze(1 / 37, 35, 1).pWin, 1 / 37, 1e-12);
    chk('欧州1点賭け n=37 で勝ち越し → 1−(36/37)^37 の「2回以上勝つ」ではなく W≥2', analyze(1 / 37, 35, 37).pWin, 1 - Math.pow(36 / 37, 37) - 37 * (1 / 37) * Math.pow(36 / 37, 36), 1e-12);
    chk('欧州赤黒 期待収支 n=37 → −1', analyze(18 / 37, 1, 37).mean, -1, 1e-12);
    chk('欧州1点賭け 標準偏差 n=1 → √(E[X²]−E[X]²)', analyze(1 / 37, 35, 1).sd, Math.sqrt((1 / 37) * 1225 + (36 / 37) - Math.pow(-1 / 37, 2)), 1e-12);
    a = pmf(18 / 37, 100000); var s = 0, i; for (i = 0; i < a.length; i++) s += a[i];
    chk('n=100,000 でも確率の合計 = 1（桁あふれなし）', s, 1, 1e-9);
    chk('損失 L=0 以下 ＝ 収支≤0 は 1−勝ち越し（整数配当）', analyze(18 / 37, 1, 101, 0, 0).pLoss + analyze(18 / 37, 1, 101).pWin, 1, 1e-12);
    chk('目標 t=0 以上 ＝ 収支≥0', analyze(18 / 37, 1, 100, 0, 5).pTarget, analyze(18 / 37, 1, 100).pEven, 1e-12);
    chk('正規近似は厳密値の近く（欧州赤黒 n=1000）', analyze(18 / 37, 1, 1000).normWin, analyze(18 / 37, 1, 1000).pWin, 0.005);
    var box = document.createElement('pre'); box.id = 'selftest';
    box.textContent = res.join('\n') + '\n\n合計 ' + res.length + ' 件 / PASS ' + (res.length - fail) + ' / FAIL ' + fail;
    document.body.appendChild(box);
  }

  function boot() {
    var el = document.getElementById('calc-kachikoshi');
    if (el) mount(el);
    if (TRACK_OFF) selftest();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
