/* ============================================================================
   勝負ラボ ベッティングシステム検証室 — 確率計算機（連敗確率・破産確率）
   ---------------------------------------------------------------------------
   - エンジン（確率の厳密計算）と UI を1ファイルに持つ。ビルドなし。
   - Node からも require できる（UI は document があるときだけ動く）。
   - 非同期処理なし（setTimeout/Promise 不使用）。計算ボタンで同期的に1回だけ計算する。
   - #selftest を付けて開くと、列挙・既知値との照合による自己テストが走る。
   - 🔴 現金・賭け金は扱わない。単位は「賭け金◯回分」。AdSense を足さないこと（隔離ドメイン）。
   ========================================================================= */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ エンジン */

  // n回のゲームの中で「k連敗以上」が1度でも起きる確率。q = 1回の負け確率。
  // 状態＝いまの連敗数(0..k-1)。k連敗に達したら吸収。計算量 O(n*k)。
  function runProb(q, n, k) {
    if (k <= 0) return 1;
    if (n < k) return 0;
    if (q <= 0) return 0;
    if (q >= 1) return 1;
    var p = 1 - q, s = new Float64Array(k), t = new Float64Array(k), hit = 0, i, r, sum, tmp;
    s[0] = 1;
    for (i = 0; i < n; i++) {
      sum = 0;
      for (r = 0; r < k; r++) sum += s[r];
      t[0] = sum * p;
      for (r = 0; r < k - 1; r++) t[r + 1] = s[r] * q;
      hit += s[k - 1] * q;
      tmp = s; s = t; t = tmp;
    }
    return hit > 1 ? 1 : hit;
  }

  // 最初の k連敗が起きるまでの平均ゲーム数 ＝ (1 − q^k) / (p q^k)
  function waitMean(q, k) {
    var p = 1 - q, qk = Math.pow(q, k);
    return (1 - qk) / (p * qk);
  }

  // n回の中の最長連敗の中央値（「k連敗以上が起きる確率」が50%を切る手前のk）。
  // 計算量が大きすぎるときは null を返す（画面では「—」）。
  function medianLongest(q, n) {
    if (q <= 0) return 0;
    if (q >= 1) return n;
    var guess = Math.ceil(Math.log(Math.max(n, 2)) / Math.log(1 / q)) + 12;
    if (n * guess * 12 > 6e7) return null;
    var lo = 0, hi = Math.min(n, guess), mid;
    // runProb(q,n,k) は k について単調減少。 P(>=k) >= 0.5 を満たす最大の k を二分探索。
    while (lo < hi) {
      mid = Math.ceil((lo + hi) / 2);
      if (runProb(q, n, mid) >= 0.5) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // ギャンブラーの破産問題（1単位ずつ賭ける）。p＝1回に勝つ確率、i＝初期資金(単位)、N＝目標(単位)。
  // N が 0/未指定なら目標なし（破産するまで続ける）。
  function ruin(p, i, N) {
    var q = 1 - p, r, a, win, dur;
    if (!(i > 0)) return { win: 0, ruin: 1, dur: 0 };
    if (!N || N === Infinity) {
      if (p <= 0.5) return { win: 0, ruin: 1, dur: Infinity };
      return { win: null, ruin: Math.pow(q / p, i), dur: null };
    }
    if (i >= N) return { win: 1, ruin: 0, dur: 0 };
    if (Math.abs(p - 0.5) < 1e-12) return { win: i / N, ruin: 1 - i / N, dur: i * (N - i) };
    r = q / p; a = Math.log(r);
    if (a > 0) {
      // r>1（負けやすいゲーム）。r^N が桁あふれしないよう指数を負側にそろえて計算する。
      win = Math.exp(-(N - i) * a) * (-Math.expm1(-i * a)) / (-Math.expm1(-N * a));
    } else {
      win = Math.expm1(i * a) / Math.expm1(N * a);
    }
    dur = i / (q - p) - (N / (q - p)) * win;
    return { win: win, ruin: 1 - win, dur: dur };
  }

  var GAMES = {
    euro:  { name: 'ヨーロピアンルーレット 赤/黒（1:1）', win: 18 / 37 },
    amer:  { name: 'アメリカンルーレット 赤/黒（1:1）',   win: 18 / 38 },
    bankr: { name: 'バカラ バンカー（引分を除いた勝負）', win: 0.458597 / (0.458597 + 0.446247) },
    playr: { name: 'バカラ プレイヤー（引分を除いた勝負）', win: 0.446247 / (0.458597 + 0.446247) },
    coin:  { name: '公正なコイン（50%）', win: 0.5 }
  };

  var api = { runProb: runProb, waitMean: waitMean, medianLongest: medianLongest, ruin: ruin, GAMES: GAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BetCalc = api;

  if (typeof document === 'undefined') return;

  /* ---------------------------------------------------------------- 表示 */
  var TRACK_OFF = (location.hash === '#selftest' || location.search.indexOf('selftest=1') >= 0);
  function track(name, params) {
    if (TRACK_OFF) return;
    try { if (window.gtag) window.gtag('event', name, params); } catch (e) { /* 計測失敗でUIを壊さない */ }
  }

  function fmtPct(x) {
    var v = x * 100;
    if (x === 0) return '限りなく0%';
    if (x >= 0.99995) return '99.99%超';
    if (v >= 10) return v.toFixed(1) + '%';
    if (v >= 0.01) return v.toFixed(2) + '%';
    var e = v.toExponential(1).replace('e-', ' × 10⁻').replace(/⁻(\d+)/, function (m, d) {
      return '⁻' + d.split('').map(function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]; }).join('');
    });
    return e + '%';
  }
  function fmtInt(x) {
    if (x === Infinity) return '終わりなし';
    if (x >= 1e12) return (x / 1e12).toFixed(1) + ' 兆';
    if (x >= 1e8) return (x / 1e8).toFixed(1) + ' 億';
    return Math.round(x).toLocaleString('ja-JP');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function gameSelect(id) {
    var h = '<select id="' + id + '">';
    Object.keys(GAMES).forEach(function (k) { h += '<option value="' + k + '">' + esc(GAMES[k].name) + '</option>'; });
    return h + '<option value="custom">自分で入力（勝つ確率 %）</option></select>';
  }
  function num(el, lo, hi, def) {
    var v = parseFloat(String(el.value).replace(/,/g, ''));
    if (!isFinite(v)) v = def;
    return Math.min(hi, Math.max(lo, v));
  }
  function winProb(gameEl, customEl) {
    if (gameEl.value === 'custom') return num(customEl, 1, 99, 48.65) / 100;
    return GAMES[gameEl.value].win;
  }
  function stat(label, value, cls) {
    return '<div class="stat"><div class="v ' + (cls || '') + '">' + value + '</div><div class="l">' + label + '</div></div>';
  }

  /* --------------------------------------------------------- 連敗確率 UI */
  function mountRenpai(el) {
    el.innerHTML =
      '<div class="fields">' +
      '<div class="field"><label for="rp-game">ゲーム</label>' + gameSelect('rp-game') + '</div>' +
      '<div class="field" id="rp-cwrap" hidden><label for="rp-custom">勝つ確率（%）</label><input id="rp-custom" type="number" inputmode="decimal" min="1" max="99" step="0.01" value="48.65"><span class="hint">1〜99。負ける確率は 100 − 勝つ確率 になります</span></div>' +
      '<div class="field"><label for="rp-n">ゲーム回数（何回やるか）</label><input id="rp-n" type="number" inputmode="numeric" min="1" max="100000" step="1" value="1000"><span class="hint">1〜100,000 回</span></div>' +
      '<div class="field"><label for="rp-k">連敗の長さ（何連敗以上か）</label><input id="rp-k" type="number" inputmode="numeric" min="1" max="60" step="1" value="10"><span class="hint">1〜60 連敗</span></div>' +
      '</div>' +
      '<div class="btnrow"><button class="primary" id="rp-go" type="button">計算する</button></div>' +
      '<div id="rp-out" aria-live="polite"></div>';
    var g = el.querySelector('#rp-game'), cw = el.querySelector('#rp-cwrap');
    g.addEventListener('change', function () { cw.hidden = g.value !== 'custom'; });
    el.querySelector('#rp-go').addEventListener('click', function () { runRenpai(el); });
    runRenpai(el, true);
  }
  function runRenpai(el, initial) {
    var g = el.querySelector('#rp-game'), p = winProb(g, el.querySelector('#rp-custom')), q = 1 - p;
    var n = Math.round(num(el.querySelector('#rp-n'), 1, 100000, 1000));
    var k = Math.round(num(el.querySelector('#rp-k'), 1, 60, 10));
    var out = el.querySelector('#rp-out');
    if (n * k > 4e7) { out.innerHTML = '<div class="msg bust">この組み合わせ（' + fmtInt(n) + '回 × ' + k + '連敗）は計算量が大きすぎます。回数を減らすか、連敗の長さを短くしてください。</div>'; return; }
    var pr = runProb(q, n, k), w = waitMean(q, k), one = Math.pow(q, k), med = medianLongest(q, n);
    var label = g.value === 'custom' ? '勝つ確率 ' + (p * 100).toFixed(2) + '%' : GAMES[g.value].name;
    var rows = '', ks = [3, 5, 7, 10, 12, 15, 20, 25, 30], j, kk, pp;
    for (j = 0; j < ks.length; j++) {
      kk = ks[j]; if (kk > n || n * kk > 4e7) continue;
      pp = runProb(q, n, kk);
      rows += '<tr' + (kk === k ? ' class="hit"' : '') + '><td>' + kk + ' 連敗以上</td><td' + (pp > 0.5 ? ' class="bad"' : '') + '>' + fmtPct(pp) + '</td><td>' + fmtInt(waitMean(q, kk)) + ' 回</td></tr>';
    }
    out.innerHTML =
      '<div class="stats">' +
      stat(fmtInt(n) + ' 回の中で ' + k + ' 連敗以上が起きる確率', fmtPct(pr), pr >= 0.5 ? 'neg' : '') +
      stat('初めて ' + k + ' 連敗するまでの平均ゲーム数', fmtInt(w) + ' 回') +
      stat('ある地点から数えて ' + k + ' 連敗する確率', fmtPct(one) + '<br><small>（約 ' + fmtInt(1 / one) + ' 回に1回）</small>') +
      stat(fmtInt(n) + ' 回での最長連敗（中央値）', med === null ? '—' : med + ' 連敗') +
      '</div>' +
      '<div class="msg ' + (pr >= 0.5 ? 'bust' : 'done') + '"><b>' + esc(label) + '</b>（1回に負ける確率 ' + (q * 100).toFixed(2) + '%）で ' + fmtInt(n) + ' 回続けると、' +
      '<b>' + k + ' 連敗以上が一度でも起きる確率は ' + fmtPct(pr) + '</b> です。' +
      (pr >= 0.5 ? 'つまり「起きるほうが普通」です。「そんなに続くことはまずない」という感覚は、回数を重ねた場面では当てになりません。' :
        'ただし回数を増やすほどこの数字は上がり続けます。10倍の回数なら、いまの値より大きくなります。') + '</div>' +
      '<div class="tablebox"><table><thead><tr><th scope="col">連敗の長さ</th><th scope="col">' + fmtInt(n) + ' 回の中で起きる確率</th><th scope="col">初めて起きるまでの平均</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="scrollhint">※ 表は横にスクロールできます。</div>';
    if (!initial) track('calc_run', { area: 'betting', tool: 'renpai', game: g.value, trials: n, k: k, from_page: location.pathname });
  }

  /* --------------------------------------------------------- 破産確率 UI */
  function mountHasan(el) {
    el.innerHTML =
      '<div class="fields">' +
      '<div class="field"><label for="hs-game">ゲーム</label>' + gameSelect('hs-game') + '</div>' +
      '<div class="field" id="hs-cwrap" hidden><label for="hs-custom">1回に勝つ確率（%）</label><input id="hs-custom" type="number" inputmode="decimal" min="1" max="99" step="0.01" value="48.65"><span class="hint">1〜99</span></div>' +
      '<div class="field"><label for="hs-i">いまの資金（賭け金の何回分か）</label><input id="hs-i" type="number" inputmode="numeric" min="1" max="100000" step="1" value="20"><span class="hint">毎回この1回分だけを賭ける前提。1〜100,000</span></div>' +
      '<div class="field"><label for="hs-n">目標の資金（賭け金の何回分か）</label><input id="hs-n" type="number" inputmode="numeric" min="0" max="100000" step="1" value="40"><span class="hint">0 にすると「目標なし（資金が尽きるまで続ける）」</span></div>' +
      '</div>' +
      '<div class="btnrow"><button class="primary" id="hs-go" type="button">計算する</button></div>' +
      '<div id="hs-out" aria-live="polite"></div>';
    var g = el.querySelector('#hs-game'), cw = el.querySelector('#hs-cwrap');
    g.addEventListener('change', function () { cw.hidden = g.value !== 'custom'; });
    el.querySelector('#hs-go').addEventListener('click', function () { runHasan(el); });
    runHasan(el, true);
  }
  function runHasan(el, initial) {
    var g = el.querySelector('#hs-game'), p = winProb(g, el.querySelector('#hs-custom'));
    var i = Math.round(num(el.querySelector('#hs-i'), 1, 100000, 20));
    var N = Math.round(num(el.querySelector('#hs-n'), 0, 100000, 40));
    var out = el.querySelector('#hs-out'), r, label = g.value === 'custom' ? '勝つ確率 ' + (p * 100).toFixed(2) + '%' : GAMES[g.value].name;
    if (N > 0 && N <= i) { out.innerHTML = '<div class="msg bust">目標の資金は、いまの資金より大きい値にしてください（目標なしにするなら 0）。</div>'; return; }
    r = ruin(p, i, N);
    var html = '', scales = [1, 2, 5, 10], rows = '', s, ri, rn, rr;
    if (N > 0) {
      html += '<div class="stats">' +
        stat('目標（' + N + ' 回分）に先に届く確率', fmtPct(r.win), r.win >= 0.5 ? 'pos' : 'neg') +
        stat('資金が尽きる（破産する）確率', fmtPct(r.ruin), r.ruin >= 0.5 ? 'neg' : '') +
        stat('決着までの平均回数', fmtInt(r.dur) + ' 回') +
        stat('1ゲームに負ける確率', ((1 - p) * 100).toFixed(2) + '%') + '</div>';
      html += '<div class="msg ' + (r.win >= 0.5 ? 'done' : 'bust') + '"><b>' + esc(label) + '</b> で、賭け金 ' + i + ' 回分の資金から ' + N + ' 回分を目指すと、' +
        '<b>目標に届く前に資金が尽きる確率は ' + fmtPct(r.ruin) + '</b>、届く確率は ' + fmtPct(r.win) + ' です。' +
        (Math.abs(p - 0.5) < 1e-9 ? '公正なゲームでは「いまの資金 ÷ 目標」がそのまま届く確率になります。' : '') + '</div>';
      for (var j = 0; j < scales.length; j++) {
        s = scales[j];
        if (i % s || N % s) continue;
        ri = i / s; rn = N / s;
        if (ri < 1 || rn <= ri) continue;
        rr = ruin(p, ri, rn);
        rows += '<tr' + (s === 1 ? ' class="hit"' : '') + '><td>賭け金を ' + s + ' 倍</td><td>' + ri + ' 回分 → ' + rn + ' 回分</td><td>' + fmtPct(rr.win) + '</td><td>' + fmtInt(rr.dur) + ' 回</td></tr>';
      }
      if (rows) html += '<h3>同じ資金・同じ目標のまま、1回の賭け金を変えると</h3><div class="tablebox"><table><thead><tr><th scope="col">賭け金</th><th scope="col">資金 → 目標</th><th scope="col">目標に届く確率</th><th scope="col">決着までの平均</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="scrollhint">※ 表は横にスクロールできます。</div>';
    } else if (p <= 0.5) {
      html += '<div class="stats">' + stat('資金が尽きる確率', '100%', 'neg') + stat('1ゲームに負ける確率', ((1 - p) * 100).toFixed(2) + '%') + '</div>' +
        '<div class="msg bust"><b>' + esc(label) + '</b> のように、1回に勝つ確率が50%以下のゲームを目標なしで続けると、<b>いつか必ず資金が尽きます（確率100%）</b>。回数に上限がなければ、資金の大小は「いつ尽きるか」しか変えません。</div>';
    } else {
      html += '<div class="stats">' + stat('資金が尽きる確率', fmtPct(r.ruin)) + '</div>' +
        '<div class="msg done">1回に勝つ確率が50%を超えるゲームは、実際の賭博にはほぼ存在しません（ここは数式の確認用です）。</div>';
    }
    out.innerHTML = html;
    if (!initial) track('calc_run', { area: 'betting', tool: 'hasan', game: g.value, units: i, target: N, from_page: location.pathname });
  }

  /* ---------------------------------------------------------- 自己テスト */
  function selftest() {
    var res = [], fail = 0;
    function chk(name, a, b, tol) { var ok = Math.abs(a - b) <= tol; if (!ok) fail++; res.push((ok ? 'PASS ' : 'FAIL ') + name + '  実装=' + a.toPrecision(8) + '  期待=' + b.toPrecision(8)); }
    // 列挙で確かめた既知値（公正なコイン）
    chk('n=2,k=2 → 1/4', runProb(0.5, 2, 2), 0.25, 1e-12);
    chk('n=3,k=2 → 3/8', runProb(0.5, 3, 2), 0.375, 1e-12);
    chk('n=4,k=2 → 8/16', runProb(0.5, 4, 2), 0.5, 1e-12);
    chk('n=5,k=3 → 8/32', runProb(0.5, 5, 3), 0.25, 1e-12);
    chk('n=10,k=4 → 0.4648…(=1−絶対に4連が無い列/1024)', runProb(0.5, 10, 4), 1 - 773 / 1024, 1e-12);
    chk('平均待ち時間 k=2 → 6', waitMean(0.5, 2), 6, 1e-12);
    chk('平均待ち時間 k=3 → 14', waitMean(0.5, 3), 14, 1e-12);
    chk('平均待ち時間 k=10 → 2046', waitMean(0.5, 10), 2046, 1e-9);
    chk('破産 公正 10/20 → 1/2', ruin(0.5, 10, 20).win, 0.5, 1e-12);
    chk('破産 公正 5/25 → 0.2', ruin(0.5, 5, 25).win, 0.2, 1e-12);
    chk('破産 平均ゲーム数 公正 10/20 → 100', ruin(0.5, 10, 20).dur, 100, 1e-9);
    chk('破産 1/2 の2連勝先取り 1/2 → p²/(p²+q²) 型 (p=.6, i=1, N=2) = p', ruin(0.6, 1, 2).win, 0.6, 1e-12);
    chk('破産 p=.6, i=2, N=4 → 0.6923…', ruin(0.6, 2, 4).win, (1 - Math.pow(2 / 3, 2)) / (1 - Math.pow(2 / 3, 4)), 1e-12);
    chk('勝ちと破産の合計 = 1 (欧州 50/100)', ruin(18 / 37, 50, 100).win + ruin(18 / 37, 50, 100).ruin, 1, 1e-12);
    var big = ruin(18 / 37, 1000, 100000); chk('桁あふれしない (1000/100000) で 0 以上 1 以下', (big.win >= 0 && big.win <= 1 && isFinite(big.dur)) ? 1 : 0, 1, 0);
    var box = document.createElement('pre'); box.id = 'selftest';
    box.textContent = res.join('\n') + '\n\n合計 ' + res.length + ' 件 / PASS ' + (res.length - fail) + ' / FAIL ' + fail;
    document.body.appendChild(box);
  }

  function boot() {
    var rp = document.getElementById('calc-renpai'), hs = document.getElementById('calc-hasan');
    if (rp) mountRenpai(rp);
    if (hs) mountHasan(hs);
    if (TRACK_OFF) selftest();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
