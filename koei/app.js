/* ============================================================================
   勝負ラボ 公営競技（競馬・競艇）資金管理法シミュレーター
   ---------------------------------------------------------------------------
   /betting/ （カジノのベッティングシステム検証室）の姉妹ツール。
   違いは「配当が固定ではなくオッズで決まる」こと。ここが公営競技の本体で、
   マーチンゲール法の必要資金の伸び方も、ココモ法が成立するかどうかも、
   すべて「オッズ o」だけで決まる。

   基本の等式（このツール全体の軸）
     1ベットあたりの期待損失率 edge = 1 − p × o        （p＝的中率, o＝オッズ倍率）
     E[収支] = − edge × E[総ベット額]                   （賭け方によらず常に成立）
   パリミュチュエル方式では、平均的な購入者について p × o = 払戻率 R になる。
   したがって edge = 1 − R ＝ 控除率。

   設計上の約束（グローバルCLAUDE.mdの原則）
   - 非同期は「自動再生の setTimeout」1本だけ。ハンドル(autoTimer)と世代番号
     (autoToken)を持ち、画面遷移・設定変更・リセットで必ず停止して全再描画する。
   - 結果は自動で流さない・自動で消さない。自動再生は既定OFF。
   - #selftest で表示と内部状態の不変条件を検証する。
   ========================================================================= */
(function () {
  'use strict';

  var UNIT = 100; // 日本の勝馬投票券・舟券は100円単位。賭け金は必ず100円単位に切り上げる

  /* ---------------------------------------------------------------- PRNG */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------ 券種・競技
     払戻率 R は一次情報。
       競馬：JRA公式「勝馬投票法ごとの払戻率について【平成26年6月7日以降】」
       競艇：BOAT RACE公式 用語辞典「払戻金」＝売上金の100分の75
     オッズの既定値は「その券種で普通に買われる水準」の例。入力で自由に変えられる。 */
  var TICKETS = {
    win:      { name: 'JRA 単勝（払戻率80.0%）',              R: 0.800, odds: 3.0 },
    place:    { name: 'JRA 複勝（払戻率80.0%）',              R: 0.800, odds: 1.5 },
    quinella: { name: 'JRA 馬連・ワイド・枠連（払戻率77.5%）', R: 0.775, odds: 8.0 },
    exacta:   { name: 'JRA 馬単・3連複（払戻率75.0%）',        R: 0.750, odds: 15.0 },
    trifecta: { name: 'JRA 3連単（払戻率72.5%）',              R: 0.725, odds: 40.0 },
    win5:     { name: 'JRA WIN5（払戻率70.0%）',              R: 0.700, odds: 200.0 },
    boat2:    { name: 'ボートレース 2連単など（払戻率75.0%）', R: 0.750, odds: 6.0 },
    boat3:    { name: 'ボートレース 3連単（払戻率75.0%）',     R: 0.750, odds: 20.0 },
    fair:     { name: '控除率0%の対照実験（払戻率100%）',      R: 1.000, odds: 2.0 }
  };

  /* ------------------------------------------------------------- 賭け方
     どの方式も「次にいくら賭けるか」だけを決める。的中率にもオッズにも触れない。
     ＝だからどれも期待値を1円も動かせない。
     ctx: { base, odds, bank, loss（それまでの累計損失）} */
  var SYSTEMS = {
    flat: {
      name: '定額（毎回おなじ額）',
      init: function () {},
      bet: function (s, c) { return c.base; },
      result: function () {},
      state: function () { return '毎回おなじ額を賭けます（比較の基準）'; }
    },
    double: {
      name: 'マーチンゲール法：単純な倍賭け',
      init: function (s) { s.n = 0; },
      bet: function (s, c) { return c.base * Math.pow(2, s.n); },
      result: function (s, c, o) { if (o === 'win') s.n = 0; else s.n++; },
      state: function (s, c) {
        return '連敗 ' + s.n + ' 回／次は基準額の ' + Math.pow(2, s.n) + ' 倍。' +
          (c.odds < 2 ? '⚠ オッズが2.0倍未満なので、倍にしても損失を取り返せません' :
            'オッズ2.0倍ちょうどのときだけ、勝てば基準額1つ分の利益になります');
      }
    },
    recover: {
      name: 'マーチンゲール法：損失回収型（正しい計算）',
      init: function (s) {},
      // それまでの累計損失 loss と目標利益 base を、オッズ o の的中1回で取り返す額
      bet: function (s, c, ctx) { return (ctx.loss + c.base) / Math.max(0.01, c.odds - 1); },
      result: function () {},
      state: function (s, c, ctx) {
        return '累計損失 ' + Math.round(ctx.loss).toLocaleString('ja-JP') + ' 円を、オッズ ' + c.odds +
          ' 倍の的中1回で取り返す額。賭け金は1回ごとに ' + (c.odds / (c.odds - 1)).toFixed(2) + ' 倍に増えます';
      }
    },
    cocomo: {
      name: 'ココモ法（直前2回の賭け金の和）',
      init: function (s) { s.hist = []; },
      bet: function (s, c) {
        var n = s.hist.length;
        return n < 2 ? c.base : s.hist[n - 1] + s.hist[n - 2];
      },
      result: function (s, c, o, bet) { if (o === 'win') s.hist = []; else s.hist.push(bet); },
      state: function (s, c) {
        return '連敗 ' + s.hist.length + ' 回／直前2回の賭け金の和。' +
          (c.odds >= 3 ? 'オッズ3.0倍以上なので、的中すれば損失を上回ります'
            : '⚠ ココモ法は配当3倍を前提にした数列です。オッズ ' + c.odds + ' 倍では的中しても損失が残る局面があります');
      }
    },
    dalembert: {
      name: 'ダランベール法（負けで+1段・勝ちで−1段）',
      init: function (s) { s.level = 0; },
      bet: function (s, c) { return c.base * (1 + s.level); },
      result: function (s, c, o) { if (o === 'win') s.level = Math.max(0, s.level - 1); else s.level++; },
      state: function (s) { return '段階 +' + s.level + '／次は基準額の ' + (1 + s.level) + ' 倍'; }
    },
    ratio: {
      name: '資金比例（手元の資金の一定割合）',
      init: function () {},
      bet: function (s, c, ctx) { return ctx.bank * (c.ratio / 100); },
      result: function () {},
      state: function (s, c) { return '手元の資金の ' + c.ratio + '%（100円単位に切り上げ）'; }
    }
  };

  function roundBet(x) {
    var v = Math.ceil(x / UNIT) * UNIT;
    return v < UNIT ? UNIT : v;
  }

  /* -------------------------------------------------- 期待値まわりの計算 */
  // 的中率の既定値：パリミュチュエルの平均的な購入者は p = R / o になる
  function autoP(R, odds) { return Math.min(1, R / odds); }
  function edgeOf(p, odds) { return 1 - p * odds; }   // 1ベットあたりの期待損失率

  /* ------------------------------------------------------ 1セッション実行
     純関数。DOMにも時間にも依存しない。
     cfg: {system, p, odds, bankroll, base, betMax, maxRaces, target, ratio} */
  function runSession(cfg, rng, keepPath) {
    var sys = SYSTEMS[cfg.system], s = {};
    sys.init(s, cfg);
    var bank = cfg.bankroll, wagered = 0, races = 0, hits = 0, curLose = 0, maxLose = 0, loss = 0;
    var ruin = null, needed = 0;
    var path = keepPath ? [bank] : null, hist = keepPath ? [] : null;
    while (races < cfg.maxRaces) {
      var ctx = { bank: bank, loss: loss, base: cfg.base };
      var bet = roundBet(sys.bet(s, cfg, ctx));
      if (!isFinite(bet) || bet > cfg.betMax) { ruin = 'limit'; needed = bet; break; }
      if (bet > bank) { ruin = 'fund'; needed = bet; break; }
      var win = rng() < cfg.p;
      races++; wagered += bet;
      if (win) {
        bank += bet * (cfg.odds - 1); hits++; curLose = 0; loss = 0;
      } else {
        bank -= bet; curLose++; if (curLose > maxLose) maxLose = curLose; loss += bet;
      }
      sys.result(s, cfg, win ? 'win' : 'lose', bet);
      if (keepPath) { path.push(bank); hist.push({ bet: bet, win: win, bank: bank }); }
      if (cfg.target > 0 && bank - cfg.bankroll >= cfg.target) break;
    }
    return {
      bank: bank, profit: bank - cfg.bankroll, wagered: wagered, races: races, hits: hits,
      maxLose: maxLose, ruin: ruin, needed: needed, path: path, hist: hist,
      reachedTarget: cfg.target > 0 && bank - cfg.bankroll >= cfg.target
    };
  }

  function runBatch(cfg, seed, n) {
    var rng = seed == null ? Math.random : mulberry32(seed);
    var profits = [], busts = 0, plus = 0, wagered = 0, races = 0, paths = [], tgt = 0, ret = 0;
    for (var i = 0; i < n; i++) {
      var res = runSession(cfg, rng, i < 24);
      profits.push(res.profit);
      if (res.ruin) busts++;
      if (res.profit > 0) plus++;
      if (res.reachedTarget) tgt++;
      wagered += res.wagered; races += res.races;
      ret += res.wagered + res.profit;   // 払戻総額 ＝ 総ベット額 + 収支
      if (i < 24) paths.push(res.path);
    }
    var sorted = profits.slice().sort(function (a, b) { return a - b; });
    var sum = profits.reduce(function (a, b) { return a + b; }, 0);
    return {
      n: n, sorted: sorted, busts: busts, plus: plus, target: tgt, sum: sum, mean: sum / n,
      median: sorted[Math.floor(n / 2)], worst: sorted[0], best: sorted[n - 1],
      meanWagered: wagered / n, meanRaces: races / n, paths: paths,
      recovery: wagered > 0 ? ret / wagered : 0,
      theory: -edgeOf(cfg.p, cfg.odds) * (wagered / n), cfg: cfg
    };
  }

  /* -------------------------------------------------------------- 表示系 */
  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function sgn(n) { return (Math.round(n) > 0 ? '+' : '') + fmt(n); }
  function pct(x) { return (x * 100).toFixed(Math.abs(x * 100) < 10 ? 2 : 1) + '%'; }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function tr(k, v, cls) { return '<tr><td>' + k + '</td><td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td></tr>'; }

  function lineChart(paths, base, w, h) {
    w = w || 640; h = h || 190;
    var pad = 6, maxLen = 1, lo = base, hi = base;
    paths.forEach(function (p) {
      if (p.length > maxLen) maxLen = p.length;
      for (var i = 0; i < p.length; i++) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; }
    });
    if (hi - lo < 1) { hi = base + 1; lo = base - 1; }
    var pdg = (hi - lo) * 0.08; hi += pdg; lo -= pdg;
    var X = function (i) { return pad + (i / Math.max(1, maxLen - 1)) * (w - pad * 2); };
    var Y = function (v) { return pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2); };
    var single = paths.length === 1;
    var out = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="資金推移グラフ">';
    out += '<line x1="0" y1="' + Y(base).toFixed(1) + '" x2="' + w + '" y2="' + Y(base).toFixed(1) + '" stroke="#8b96c9" stroke-width="1" stroke-dasharray="4 4"/>';
    paths.forEach(function (p) {
      var d = p.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
      out += '<polyline points="' + d + '" fill="none" stroke="' + (single ? '#29e0ff' : '#59f5c0') +
        '" stroke-width="' + (single ? 2 : 1) + '" opacity="' + (single ? 1 : 0.45) + '"/>';
    });
    return out + '</svg>';
  }

  function histChart(sorted, w, h) {
    w = w || 640; h = h || 190;
    var pad = 6, bins = 26, lo = sorted[0], hi = sorted[sorted.length - 1];
    if (hi - lo < 1) hi = lo + 1;
    var counts = new Array(bins).fill(0);
    sorted.forEach(function (v) { counts[Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins))]++; });
    var mx = Math.max.apply(null, counts), bw = (w - pad * 2) / bins;
    var out = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="最終収支の分布">';
    for (var i = 0; i < bins; i++) {
      var bh = (counts[i] / mx) * (h - pad * 2 - 10);
      var mid = lo + (i + 0.5) / bins * (hi - lo);
      out += '<rect x="' + (pad + i * bw + 1).toFixed(1) + '" y="' + (h - pad - bh).toFixed(1) +
        '" width="' + Math.max(0.5, bw - 2).toFixed(1) + '" height="' + bh.toFixed(1) +
        '" fill="' + (mid >= 0 ? '#3fe37f' : '#ff5470') + '" opacity="0.85"/>';
    }
    if (lo < 0 && hi > 0) {
      var zx = pad + (-lo) / (hi - lo) * (w - pad * 2);
      out += '<line x1="' + zx.toFixed(1) + '" y1="0" x2="' + zx.toFixed(1) + '" y2="' + h + '" stroke="#ffd23e" stroke-width="1" stroke-dasharray="3 3"/>';
    }
    return out + '</svg>';
  }

  /* ============================================================== UI 本体 */
  function boot(root) {
    var lockedSystem = root.getAttribute('data-system') || null;
    var defaultTicket = root.getAttribute('data-ticket') || 'win';

    var view = 'play';
    var session = null;
    var autoTimer = null;
    var autoToken = 0;
    var lastBatch = null;

    root.innerHTML = '';
    var fields = el('div', 'fields');
    function addField(id, label, html, hint) {
      var f = el('div', 'field');
      var l = el('label', null, label); l.setAttribute('for', id); f.appendChild(l);
      var tmp = document.createElement('div'); tmp.innerHTML = html; f.appendChild(tmp.firstChild);
      if (hint) f.appendChild(el('div', 'hint', hint));
      fields.appendChild(f);
      return f;
    }
    if (!lockedSystem) {
      addField('f-system', '資金管理の方法',
        '<select id="f-system">' + Object.keys(SYSTEMS).map(function (k) {
          return '<option value="' + k + '">' + SYSTEMS[k].name + '</option>';
        }).join('') + '</select>');
    }
    addField('f-ticket', '競技・券種（払戻率）',
      '<select id="f-ticket">' + Object.keys(TICKETS).map(function (k) {
        return '<option value="' + k + '"' + (k === defaultTicket ? ' selected' : '') + '>' + TICKETS[k].name + '</option>';
      }).join('') + '</select>',
      '払戻率は競馬＝JRA公式の券種別設定値、競艇＝BOAT RACE公式（売上金の100分の75）。控除率＝1−払戻率');
    addField('f-odds', 'オッズ（倍・元返し込み）', '<input id="f-odds" type="number" inputmode="decimal" min="1.01" step="0.1" value="3.0">',
      '100円が何円になって返ってくるか。1.5倍なら150円（純利益は50円）');
    addField('f-pmode', '的中率の決め方',
      '<select id="f-pmode"><option value="auto" selected>平均的な購入者（払戻率 ÷ オッズ）</option><option value="manual">自分で指定する</option></select>',
      'パリミュチュエル方式では、全体の平均は必ず「的中率×オッズ＝払戻率」になります');
    var pf = addField('f-p', '的中率（%）', '<input id="f-p" type="number" inputmode="decimal" min="0.01" max="100" step="0.1" value="26.7">',
      '自分の予想力を仮定する欄。払戻率を超える値を入れると「平均を上回る予想ができる」と仮定したことになります');
    addField('f-bankroll', '初期資金（仮想・円）', '<input id="f-bankroll" type="number" inputmode="numeric" min="1000" step="10000" value="100000">');
    addField('f-base', '基準の賭け金（仮想・円）', '<input id="f-base" type="number" inputmode="numeric" min="100" step="100" value="1000">');
    var rf = addField('f-ratio', '資金比例：手元の何%を賭けるか', '<input id="f-ratio" type="number" inputmode="decimal" min="0.1" max="100" step="0.5" value="5">');
    addField('f-betmax', '1レースに賭ける上限（自分で決める歯止め）', '<input id="f-betmax" type="number" inputmode="numeric" min="100" step="1000" value="50000">',
      'カジノと違い公営競技には店側の上限がありません。歯止めは自分で決めるしかない、という事情をここで再現します');
    addField('f-races', '1セッションの最大レース数', '<input id="f-races" type="number" inputmode="numeric" min="1" max="5000" step="10" value="100">');
    addField('f-target', '利益目標に届いたらやめる（0で無効）', '<input id="f-target" type="number" inputmode="numeric" min="0" step="1000" value="0">',
      '「やめ時を決めれば勝てる」のかどうかも、ここで試せます');
    addField('f-runs', '一括試行のセッション数', '<select id="f-runs"><option value="200">200</option><option value="1000" selected>1,000</option><option value="5000">5,000</option></select>');
    addField('f-seed', '乱数シード（空欄＝毎回ランダム）', '<input id="f-seed" type="number" inputmode="numeric" step="1" placeholder="例: 20260902">',
      '同じ数字を入れれば何度でも同じ結果を再現できます');
    root.appendChild(fields);

    var tabs = el('div', 'tabs');
    var tabPlay = el('button', 'active', '1レースずつ');
    var tabBatch = el('button', null, '一括試行');
    tabs.appendChild(tabPlay); tabs.appendChild(tabBatch);
    root.appendChild(tabs);

    var panel = el('div');
    root.appendChild(panel);

    var $ = function (id) { return document.getElementById(id); };
    var selSystem = lockedSystem ? null : $('f-system');

    function syncFields() {
      var sys = lockedSystem || (selSystem ? selSystem.value : 'flat');
      rf.style.display = sys === 'ratio' ? '' : 'none';
      pf.style.display = $('f-pmode').value === 'manual' ? '' : 'none';
      if ($('f-pmode').value === 'auto') {
        var t = TICKETS[$('f-ticket').value];
        var o = parseFloat($('f-odds').value);
        if (isFinite(o) && o > 1) $('f-p').value = (autoP(t.R, o) * 100).toFixed(2);
      }
    }
    // 券種を変えたらオッズの既定値も一緒に動かす（券種ごとに現実的な水準が違うため）
    var lastTicket = defaultTicket;
    $('f-ticket').addEventListener('change', function () {
      if ($('f-ticket').value !== lastTicket) {
        lastTicket = $('f-ticket').value;
        $('f-odds').value = TICKETS[lastTicket].odds;
      }
    });
    $('f-odds').value = TICKETS[defaultTicket].odds;

    function cfg() {
      var num = function (id, d) { var v = parseFloat($(id).value); return isFinite(v) ? v : d; };
      var t = TICKETS[$('f-ticket').value];
      var odds = Math.max(1.01, num('f-odds', 3));
      var p = $('f-pmode').value === 'manual'
        ? Math.min(1, Math.max(0.0001, num('f-p', 30) / 100))
        : autoP(t.R, odds);
      return {
        system: lockedSystem || selSystem.value,
        ticket: $('f-ticket').value, R: t.R,
        odds: odds, p: p,
        bankroll: Math.max(100, num('f-bankroll', 100000)),
        base: Math.max(UNIT, num('f-base', 1000)),
        ratio: Math.min(100, Math.max(0.1, num('f-ratio', 5))),
        betMax: Math.max(UNIT, num('f-betmax', 50000)),
        maxRaces: Math.min(5000, Math.max(1, num('f-races', 100))),
        target: Math.max(0, num('f-target', 0)),
        runs: parseInt($('f-runs').value, 10) || 1000,
        seedRaw: ($('f-seed').value || '').trim()
      };
    }
    function seedOf(c) {
      if (c.seedRaw === '') return null;
      var s = parseInt(c.seedRaw, 10);
      return isFinite(s) ? (s >>> 0) : null;
    }

    /* ---------------------------------------- 自動再生（唯一の非同期処理） */
    function stopAuto() {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      autoToken++;
    }
    function tickAuto(token) {
      if (token !== autoToken) return;
      if (view !== 'play' || !session || session.over) { stopAuto(); renderPlay(); return; }
      stepOnce(); renderPlay();
      if (session.over) { stopAuto(); renderPlay(); return; }
      autoTimer = setTimeout(function () { tickAuto(token); }, 900);
    }
    function startAuto() {
      stopAuto();
      var token = autoToken;
      autoTimer = setTimeout(function () { tickAuto(token); }, 900);
      renderPlay();
    }

    /* ------------------------------------------------------- 1レースずつ */
    function newSession() {
      stopAuto();
      var c = cfg(), sd = seedOf(c);
      session = {
        cfg: c, sys: SYSTEMS[c.system], s: {},
        rng: sd == null ? Math.random : mulberry32(sd),
        bank: c.bankroll, wagered: 0, races: 0, curLose: 0, maxLose: 0, loss: 0,
        path: [c.bankroll], hist: [], over: false, ruin: null, needed: 0, hitTarget: false
      };
      session.sys.init(session.s, c);
      renderPlay();
    }
    function nextBetOf() {
      var c = session.cfg;
      return roundBet(session.sys.bet(session.s, c, { bank: session.bank, loss: session.loss, base: c.base }));
    }
    function stepOnce() {
      if (!session || session.over) return;
      var c = session.cfg;
      var bet = nextBetOf();
      if (!isFinite(bet) || bet > c.betMax) { session.over = true; session.ruin = 'limit'; session.needed = bet; return; }
      if (bet > session.bank) { session.over = true; session.ruin = 'fund'; session.needed = bet; return; }
      var win = session.rng() < c.p;
      session.races++; session.wagered += bet;
      if (win) { session.bank += bet * (c.odds - 1); session.curLose = 0; session.loss = 0; }
      else { session.bank -= bet; session.curLose++; if (session.curLose > session.maxLose) session.maxLose = session.curLose; session.loss += bet; }
      session.sys.result(session.s, c, win ? 'win' : 'lose', bet);
      session.path.push(session.bank);
      session.hist.push({ bet: bet, win: win, bank: session.bank });
      if (c.target > 0 && session.bank - c.bankroll >= c.target) { session.over = true; session.hitTarget = true; }
      else if (session.races >= c.maxRaces) { session.over = true; }
    }

    // 所有する要素は毎回まるごと作り直す（部分更新をしない）
    function renderPlay() {
      if (view !== 'play') return;
      panel.innerHTML = '';
      if (!session) {
        panel.appendChild(el('div', 'msg', '設定を決めて「開始」を押してください。1レースずつ手で進みます（自動再生は任意）。'));
        var row0 = el('div', 'btnrow');
        var b0 = el('button', 'primary', '開始'); b0.onclick = newSession;
        row0.appendChild(b0); panel.appendChild(row0);
        return;
      }
      var c = session.cfg;
      var edge = edgeOf(c.p, c.odds);
      var nextBet = session.over && session.needed ? session.needed : nextBetOf();
      var prof = session.bank - c.bankroll;

      var stats = el('div', 'stats');
      function stat(v, l, cls) {
        var d = el('div', 'stat');
        d.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), v));
        d.appendChild(el('div', 'l', l));
        stats.appendChild(d);
      }
      stat(fmt(session.bank), '手元の資金');
      stat(sgn(prof), '収支', prof >= 0 ? 'pos' : 'neg');
      stat(fmt(nextBet), session.over && session.needed ? '必要だった賭け金' : '次の賭け金');
      stat(session.races + ' R', 'レース数（最大 ' + c.maxRaces + '）');
      panel.appendChild(stats);

      panel.appendChild(el('div', 'seqbox',
        session.sys.state(session.s, c, { bank: session.bank, loss: session.loss, base: c.base })));

      var hist = el('div', 'hist');
      if (session.hist.length === 0) hist.appendChild(el('small', null, '（まだ1レースも進んでいません）'));
      session.hist.slice(-24).forEach(function (h) {
        hist.appendChild(el('div', 'pip ' + (h.win ? 'w' : 'l'), h.win ? '的' : '外'));
      });
      panel.appendChild(hist);

      var cw = document.createElement('div');
      cw.innerHTML = lineChart([session.path], c.bankroll);
      panel.appendChild(cw.firstChild);
      panel.appendChild(el('div', 'legend', '点線＝初期資金 ' + fmt(c.bankroll) + ' 円。線が点線より下なら負け越しです。'));

      var msg;
      if (session.over && session.ruin === 'limit') {
        msg = el('div', 'msg bust');
        msg.innerHTML = '<b>続行不能：自分で決めた1レースの上限を超えました</b><br>次に必要な賭け金は <b>' + fmt(session.needed) +
          ' 円</b>、上限は ' + fmt(c.betMax) + ' 円。ここで <b>' + sgn(prof) + ' 円</b>が確定します。' +
          '<br><small>公営競技には店側の上限がありません。上限を外せば賭け続けられますが、その先にあるのは「資金不足」です。</small>';
      } else if (session.over && session.ruin === 'fund') {
        msg = el('div', 'msg bust');
        msg.innerHTML = '<b>破綻：資金不足で続行不能</b><br>次に必要な賭け金 <b>' + fmt(session.needed) +
          ' 円</b>に対し、手元は ' + fmt(session.bank) + ' 円。<b>' + sgn(prof) + ' 円</b>が確定します。';
      } else if (session.over && session.hitTarget) {
        msg = el('div', 'msg done');
        msg.innerHTML = '<b>利益目標に届いたので終了しました（' + sgn(prof) + ' 円）。</b><br>' +
          '<small>1日勝つのは難しくありません。問題は「同じことを何百回も繰り返したらどうなるか」です。上のタブの一括試行で確かめてください。</small>';
      } else if (session.over) {
        msg = el('div', 'msg done');
        msg.innerHTML = '<b>最大レース数に到達して終了。収支 ' + sgn(prof) + ' 円</b>／総ベット額 ' + fmt(session.wagered) + ' 円。' +
          '<br><small>理論上の期待収支＝−控除率 ' + pct(edge) + ' × 総ベット額 ＝ <b>' + sgn(-edge * session.wagered) + ' 円</b></small>';
      } else {
        msg = el('div', 'msg');
        msg.innerHTML = '総ベット額 ' + fmt(session.wagered) + ' 円／最大連敗 ' + session.maxLose +
          '。ここまでの理論上の期待収支は <b>' + sgn(-edge * session.wagered) + ' 円</b>です。';
      }
      panel.appendChild(msg);

      var row = el('div', 'btnrow');
      var b1 = el('button', 'primary', '次の1レース'); b1.disabled = session.over;
      b1.onclick = function () { stopAuto(); stepOnce(); renderPlay(); };
      var b10 = el('button', null, '10レース進む'); b10.disabled = session.over;
      b10.onclick = function () { stopAuto(); for (var i = 0; i < 10 && !session.over; i++) stepOnce(); renderPlay(); };
      var bA = el('button', autoTimer ? 'danger' : null, autoTimer ? '自動再生を止める' : '自動再生');
      bA.disabled = session.over;
      bA.onclick = function () { if (autoTimer) { stopAuto(); renderPlay(); } else { startAuto(); } };
      var bR = el('button', 'ghost', '最初からやり直す'); bR.onclick = newSession;
      row.appendChild(b1); row.appendChild(b10); row.appendChild(bA); row.appendChild(bR);
      panel.appendChild(row);
    }

    /* ------------------------------------------------------------ 一括試行 */
    function renderBatch(running) {
      if (view !== 'batch') return;
      panel.innerHTML = '';
      var row = el('div', 'btnrow');
      var b = el('button', 'primary', running ? '計算中…' : '一括試行を実行');
      b.disabled = !!running;
      b.onclick = function () {
        renderBatch(true);
        setTimeout(function () {
          if (view !== 'batch') return;
          var c = cfg();
          lastBatch = runBatch(c, seedOf(c), c.runs);
          renderBatch(false);
        }, 30);
      };
      row.appendChild(b);
      panel.appendChild(row);

      if (!lastBatch) {
        panel.appendChild(el('div', 'msg',
          '同じ設定を何百回・何千回とまとめて回して、破綻率・収支の分布・回収率・期待値との一致を見ます。結果は自動で消えません。'));
        return;
      }
      var r = lastBatch, c2 = r.cfg, edge = edgeOf(c2.p, c2.odds);

      var stats = el('div', 'stats');
      function stat(v, l, cls) {
        var d = el('div', 'stat');
        d.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), v));
        d.appendChild(el('div', 'l', l));
        stats.appendChild(d);
      }
      stat(pct(r.plus / r.n), 'プラスで終わった割合', 'pos');
      stat(pct(r.busts / r.n), '続行不能になった割合', 'neg');
      stat(pct(r.recovery), '回収率（払戻総額÷総ベット額）', r.recovery >= 1 ? 'pos' : 'neg');
      stat(sgn(r.sum), r.n.toLocaleString('ja-JP') + 'セッションの合計収支', r.sum >= 0 ? 'pos' : 'neg');
      panel.appendChild(stats);

      var hb = document.createElement('div'); hb.innerHTML = histChart(r.sorted);
      panel.appendChild(hb.firstChild);
      panel.appendChild(el('div', 'legend', '最終収支の分布。緑＝プラス／赤＝マイナス、黄色の点線が収支±0の位置です。'));

      var pb = document.createElement('div'); pb.innerHTML = lineChart(r.paths, c2.bankroll);
      panel.appendChild(pb.firstChild);
      panel.appendChild(el('div', 'legend', '最初の24セッションの資金推移を重ねたもの。'));

      var tb = el('div', 'tablebox');
      tb.innerHTML = '<table><tbody>' +
        tr('セッション数', r.n.toLocaleString('ja-JP')) +
        tr('プラスで終わったセッション', r.plus.toLocaleString('ja-JP') + ' 回（' + pct(r.plus / r.n) + '）') +
        tr('続行不能（資金不足・自分の上限）', r.busts.toLocaleString('ja-JP') + ' 回（' + pct(r.busts / r.n) + '）') +
        (c2.target > 0 ? tr('利益目標に到達', r.target.toLocaleString('ja-JP') + ' 回（' + pct(r.target / r.n) + '）') : '') +
        tr('収支の中央値', sgn(r.median) + ' 円') +
        tr('最良のセッション', sgn(r.best) + ' 円', 'good') +
        tr('最悪のセッション', sgn(r.worst) + ' 円', 'bad') +
        tr('平均レース数', r.meanRaces.toFixed(1) + ' R') +
        tr('平均の総ベット額', fmt(r.meanWagered) + ' 円') +
        tr('実測の回収率', pct(r.recovery), r.recovery >= 1 ? 'good' : 'bad') +
        tr('設定した的中率 × オッズ（＝理論上の回収率）', pct(c2.p * c2.odds), 'bad') +
        tr('理論値：−控除率 × 平均総ベット額', sgn(r.theory) + ' 円', 'bad') +
        tr('実測：1セッションの平均収支', sgn(r.mean) + ' 円', 'bad') +
        tr('理論値との差（誤差）', sgn(r.mean - r.theory) + ' 円') +
        '</tbody></table>';
      panel.appendChild(tb);

      var plusPct = r.plus / r.n;
      var read = el('div', 'readme');
      read.innerHTML = '<h3>この結果の読み方</h3>' +
        '<p><b>' + r.n.toLocaleString('ja-JP') + ' セッション中 ' + r.plus.toLocaleString('ja-JP') + ' 回（' + pct(plusPct) +
        '）がプラスで終わりました。</b>' + (plusPct > 0.6 ? 'ぱっと見は「勝てている」ように見えます。' : '') +
        'それでも合計収支は <b>' + sgn(r.sum) + ' 円</b>です。' +
        (plusPct > 0.6 ? '小さな勝ちを何度も積み上げ、たまに来る大きな負けで全部返している——それがこのヒストグラムの形です。' : '') + '</p>' +
        '<p>表の下の方を見てください。<b>実測の平均収支 ' + sgn(r.mean) + ' 円</b>は、' +
        '<b>−控除率 ' + pct(edge) + ' × 平均総ベット額 ' + fmt(r.meanWagered) + ' 円 ＝ ' + sgn(r.theory) + ' 円</b> とほぼ一致します。' +
        '賭け方をどう工夫しても、期待される損失は「賭けた総額 × 控除率」に吸い寄せられます。' +
        (edge <= 1e-9
          ? 'なお今回は控除率0%の対照実験なので期待値はちょうど0です。それでも破綻がゼロにならないことに注目してください（資金が有限だからです）。'
          : '差が残るのは試行回数が有限だからで、増やすほど小さくなります。') + '</p>' +
        '<p><b>回収率 ' + pct(r.recovery) + '</b> は、賭けた総額に対して戻ってきた総額の割合です。' +
        '公営競技では、平均的な買い方をしているかぎりこの数字は<b>払戻率（' + pct(c2.R) + '）</b>に近づきます。' +
        '資金管理の方法を変えても、この数字は動きません。動くのは「どういう負け方をするか」だけです。</p>';
      panel.appendChild(read);
    }

    /* -------------------------------------------------------- タブ・イベント */
    function switchView(v) {
      stopAuto();
      view = v;
      tabPlay.className = v === 'play' ? 'active' : '';
      tabBatch.className = v === 'batch' ? 'active' : '';
      panel.innerHTML = '';
      if (v === 'play') renderPlay(); else renderBatch(false);
    }
    tabPlay.onclick = function () { switchView('play'); };
    tabBatch.onclick = function () { switchView('batch'); };

    function onSettingChange() {
      stopAuto();
      session = null; lastBatch = null;
      syncFields();
      panel.innerHTML = '';
      if (view === 'play') renderPlay(); else renderBatch(false);
    }
    Array.prototype.forEach.call(root.querySelectorAll('input,select'), function (n) {
      n.addEventListener('change', onSettingChange);
    });

    syncFields();
    renderPlay();

    root.__test = {
      getState: function () { return { view: view, session: session, autoTimer: autoTimer, autoToken: autoToken }; },
      stopAuto: stopAuto, startAuto: startAuto, tickAuto: tickAuto,
      newSession: newSession, stepOnce: stepOnce, renderPlay: renderPlay, nextBetOf: nextBetOf,
      switchView: switchView, panel: panel, cfg: cfg
    };
  }

  /* ================================================== 控除率の壁 計算機 */
  // 同じ資金を n 回転させると、期待して手元に残るのは 初期資金 × R^n。
  function bootWall(root) {
    root.innerHTML = '';
    var fields = el('div', 'fields');
    fields.innerHTML =
      '<div class="field"><label for="w-fund">元手（仮想・円）</label>' +
      '<input id="w-fund" type="number" inputmode="numeric" min="100" step="10000" value="100000"></div>' +
      '<div class="field"><label for="w-r">払戻率（%）</label>' +
      '<select id="w-r">' +
      '<option value="80">80.0%（JRA 単勝・複勝）</option>' +
      '<option value="77.5">77.5%（JRA 馬連・ワイド・枠連）</option>' +
      '<option value="75" selected>75.0%（JRA 馬単・3連複／ボートレース）</option>' +
      '<option value="72.5">72.5%（JRA 3連単）</option>' +
      '<option value="70">70.0%（JRA WIN5）</option>' +
      '</select></div>' +
      '<div class="field"><label for="w-n">何回転させるか（同じ資金を賭け直す回数）</label>' +
      '<input id="w-n" type="number" inputmode="numeric" min="1" max="200" step="1" value="10"></div>';
    root.appendChild(fields);
    var out = el('div');
    root.appendChild(out);

    function render() {
      out.innerHTML = '';
      var fund = parseFloat(document.getElementById('w-fund').value) || 100000;
      var R = (parseFloat(document.getElementById('w-r').value) || 75) / 100;
      var n = Math.min(200, Math.max(1, parseInt(document.getElementById('w-n').value, 10) || 10));

      var stats = el('div', 'stats');
      function stat(v, l, cls) {
        var d = el('div', 'stat');
        d.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), v));
        d.appendChild(el('div', 'l', l));
        stats.appendChild(d);
      }
      var left = fund * Math.pow(R, n);
      stat(fmt(left) + ' 円', n + ' 回転後に期待して残る額', 'neg');
      stat(pct(Math.pow(R, n)), '元手に対する残存率', 'neg');
      stat(pct(1 - R), '1回あたりの控除率');
      stat(fmt(fund - left) + ' 円', '主催者側に渡る合計（期待値）');
      out.appendChild(stats);

      var rows = '';
      [1, 2, 3, 5, 10, 20, 30, 50, 100].forEach(function (k) {
        rows += tr(k + ' 回転', fmt(fund * Math.pow(R, k)) + ' 円（' + pct(Math.pow(R, k)) + '）', k >= 10 ? 'bad' : '');
      });
      var tb = el('div', 'tablebox');
      tb.innerHTML = '<table><thead><tr><th>回転数</th><th>期待して手元に残る額</th></tr></thead><tbody>' + rows + '</tbody></table>';
      out.appendChild(tb);

      var msg = el('div', 'msg');
      msg.innerHTML = '<b>1回あたりの控除率は ' + pct(1 - R) + ' でも、同じ資金を回し続けると指数関数で削られます。</b>' +
        '<br>' + n + ' 回転で残るのは元手の ' + pct(Math.pow(R, n)) + '。' +
        '「回収率' + pct(R) + '」という数字は1回の話であって、遊び続けたときの数字ではありません。' +
        '<br><small>※ これは「平均的な買い方をした場合の期待値」です。実際には的中の当たり外れでこの前後に大きくばらつきます。' +
        '当てた分をまた次のレースに入れる（回転させる）ほど、この曲線に近づきます。</small>';
      out.appendChild(msg);
    }
    Array.prototype.forEach.call(root.querySelectorAll('input,select'), function (n) {
      n.addEventListener('change', render);
      n.addEventListener('input', render);
    });
    render();
    root.__testWall = { render: render, out: out };
  }

  /* ============================================================= 自己テスト */
  function selfTest(root) {
    var out = [], pass = 0, fail = 0;
    function ok(name, cond, extra) {
      (cond ? (pass++, out.push('PASS  ' + name + (extra ? '  ' + extra : '')))
            : (fail++, out.push('FAIL  ' + name + (extra ? '  ' + extra : ''))));
    }
    var T = root.__test || null;   // シミュレーターが無いページ（控除率の壁だけ）では null

    /* 1) 賭け金の進行ルール（勝敗を固定して並びを照合） */
    function prog(sysKey, outcomes, c) {
      var s = {}, bets = [], sys = SYSTEMS[sysKey], loss = 0, bank = c.bankroll || 1e9;
      sys.init(s, c);
      outcomes.forEach(function (o) {
        var b = roundBet(sys.bet(s, c, { loss: loss, bank: bank, base: c.base }));
        bets.push(b);
        if (o === 'win') { bank += b * (c.odds - 1); loss = 0; } else { bank -= b; loss += b; }
        sys.result(s, c, o, b);
      });
      return JSON.stringify(bets);
    }
    var C2 = { base: 1000, odds: 2.0, bankroll: 1e9 };
    var C15 = { base: 1000, odds: 1.5, bankroll: 1e9 };
    ok('定額：ずっと同じ額', prog('flat', ['lose', 'lose', 'win', 'lose'], C2) === '[1000,1000,1000,1000]');
    ok('単純な倍賭け：負けで倍・勝ちで戻る', prog('double', ['lose', 'lose', 'lose', 'win', 'lose'], C2) === '[1000,2000,4000,8000,1000]');
    ok('ダランベール：負けで+1段・勝ちで−1段', prog('dalembert', ['lose', 'lose', 'win', 'win', 'win'], C2) === '[1000,2000,3000,2000,1000]');
    ok('ココモ：直前2回の和（1,1,2,3,5,8）', prog('cocomo', ['lose', 'lose', 'lose', 'lose', 'lose', 'lose'], C2) === '[1000,1000,2000,3000,5000,8000]');
    // 損失回収型：オッズ2.0倍なら 1000,2000,4000,8000（倍賭けと一致する）
    ok('損失回収型：オッズ2.0倍では倍賭けと一致', prog('recover', ['lose', 'lose', 'lose', 'lose'], C2) === '[1000,2000,4000,8000]');
    // オッズ1.5倍なら成長率は o/(o-1)=3 倍
    ok('損失回収型：オッズ1.5倍では3倍ずつ増える', prog('recover', ['lose', 'lose', 'lose', 'lose'], C15) === '[2000,6000,18000,54000]',
      prog('recover', ['lose', 'lose', 'lose', 'lose'], C15));

    /* 2) 100円単位への切り上げ */
    ok('賭け金は必ず100円単位', roundBet(1) === 100 && roundBet(101) === 200 && roundBet(1000) === 1000 && roundBet(0) === 100);
    (function () {
      var c = { system: 'ratio', ticket: 'win', R: 0.8, odds: 3, p: 0.2667, bankroll: 100000, base: 1000, ratio: 3.3, betMax: 1e9, maxRaces: 60, target: 0 };
      var r = runSession(c, mulberry32(5), true);
      ok('資金比例でも全ベットが100円単位', r.hist.every(function (h) { return h.bet % 100 === 0; }));
    })();

    /* 3) 損失回収型は「的中1回で必ず基準額の利益になる」 */
    (function () {
      var odds = [1.2, 1.5, 2.0, 3.0, 7.5];
      var good = odds.every(function (o) {
        var c = { base: 1000, odds: o, bankroll: 1e12 };
        var s = {}, loss = 0, bank = 1e12;
        SYSTEMS.recover.init(s, c);
        for (var i = 0; i < 6; i++) {   // 6連敗
          var b = roundBet(SYSTEMS.recover.bet(s, c, { loss: loss, bank: bank, base: 1000 }));
          bank -= b; loss += b;
        }
        var last = roundBet(SYSTEMS.recover.bet(s, c, { loss: loss, bank: bank, base: 1000 }));
        var profit = last * (o - 1) - loss;   // 7回目に的中したときの純益
        return profit >= 1000 - 1e-9;          // 100円単位に切り上げているので基準額以上になる
      });
      ok('損失回収型：6連敗後に的中すれば必ず基準額以上の利益', good);
    })();

    /* 4) 単純な倍賭けは、オッズ2.0倍未満だと的中しても損失が残る
          純益 = b(2ⁿ(o−2) + 1) */
    (function () {
      function netAfter(o, n, b) { return b * (Math.pow(2, n) * (o - 2) + 1); }
      ok('倍賭け：オッズ2.0倍なら何連敗後でも純益＝基準額',
        Math.abs(netAfter(2.0, 0, 1000) - 1000) < 1e-9 && Math.abs(netAfter(2.0, 8, 1000) - 1000) < 1e-9);
      ok('倍賭け：オッズ1.5倍だと1連敗後の的中で純益ゼロ、2連敗後はマイナス',
        Math.abs(netAfter(1.5, 1, 1000)) < 1e-9 && netAfter(1.5, 2, 1000) < 0,
        '1連敗後 ' + netAfter(1.5, 1, 1000) + ' / 2連敗後 ' + netAfter(1.5, 2, 1000));
      ok('倍賭け：オッズ3.0倍なら連敗が深いほど純益が増える',
        netAfter(3, 5, 1000) > netAfter(3, 2, 1000));
    })();

    /* 5) ココモ法は配当3倍が前提。オッズ2.5倍では深い連敗で「勝っても損」 */
    (function () {
      function cocomoNet(o, n, b) {   // n連敗後に的中したときの純益
        var seq = [], loss = 0;
        for (var i = 0; i < n; i++) {
          var x = seq.length < 2 ? b : seq[seq.length - 1] + seq[seq.length - 2];
          seq.push(x); loss += x;
        }
        var next = seq.length < 2 ? b : seq[seq.length - 1] + seq[seq.length - 2];
        return next * (o - 1) - loss;
      }
      ok('ココモ：オッズ3.0倍なら連敗が深いほど利益が増える',
        cocomoNet(3, 0, 1000) > 0 && cocomoNet(3, 6, 1000) > cocomoNet(3, 3, 1000));
      ok('ココモ：オッズ2.0倍では1連敗以降ずっと利益ゼロ以下',
        cocomoNet(2, 1, 1000) <= 0 && cocomoNet(2, 5, 1000) < 0,
        '1連敗 ' + cocomoNet(2, 1, 1000) + ' / 5連敗 ' + cocomoNet(2, 5, 1000));
      ok('ココモ：オッズ2.5倍では6連敗以降は的中しても損',
        cocomoNet(2.5, 5, 1000) === 0 && cocomoNet(2.5, 6, 1000) < 0,
        '5連敗 ' + cocomoNet(2.5, 5, 1000) + ' / 6連敗 ' + cocomoNet(2.5, 6, 1000));
    })();

    /* 6) 会計が合う：資金推移の終点＝最終収支 */
    (function () {
      var c = { system: 'double', ticket: 'win', R: 0.8, odds: 3.0, p: 0.2667, bankroll: 5e7, base: 1000, ratio: 5, betMax: 1e9, maxRaces: 200, target: 0 };
      var r = runSession(c, mulberry32(4242), true);
      ok('会計：資金推移の終点＝最終収支', Math.abs((r.path[r.path.length - 1] - c.bankroll) - r.profit) < 1e-6);
      var sum = r.hist.reduce(function (a, h) { return a + (h.win ? h.bet * (c.odds - 1) : -h.bet); }, 0);
      ok('会計：1レースごとの増減の総和＝最終収支', Math.abs(sum - r.profit) < 1e-6);
      var paid = r.hist.reduce(function (a, h) { return a + (h.win ? h.bet * c.odds : 0); }, 0);
      ok('会計：払戻総額 ＝ 総ベット額 ＋ 収支',
        Math.abs(paid - (r.wagered + r.profit)) < 1e-6, '払戻 ' + Math.round(paid) + ' / ベット+収支 ' + Math.round(r.wagered + r.profit));
    })();

    /* 7) 再現性：同じシードなら完全に同じ結果 */
    (function () {
      var c = { system: 'cocomo', ticket: 'boat3', R: 0.75, odds: 20, p: 0.0375, bankroll: 300000, base: 1000, ratio: 5, betMax: 100000, maxRaces: 150, target: 0 };
      var a = runSession(c, mulberry32(777), false), b = runSession(c, mulberry32(777), false);
      ok('再現性：同一シードで同一結果', a.profit === b.profit && a.races === b.races);
    })();

    /* 8) 🔴 期待値の同一性を厳密に検証する
          乱数の平均では分散が大きすぎて収束しないので、深さ d の的中/不的中パターンを
          全列挙し、確率で重み付けした厳密な期待値を計算して
          E[収支] = −(1 − p×o) × E[総ベット額] が機械精度で成り立つことを確かめる。 */
    function exactEV(base, depth) {
      var total = Math.pow(2, depth), EP = 0, EW = 0, p = base.p;
      for (var n = 0; n < total; n++) {
        var t = n, prob = 1, seq = [];
        for (var d = 0; d < depth; d++) {
          var winFlag = (t & 1) === 1; t >>= 1;
          prob *= winFlag ? p : (1 - p);
          seq.push(winFlag ? 0 : 1 - 1e-12);   // rng の戻り値：p未満＝的中
        }
        var i = 0;
        var c = {}; for (var k in base) c[k] = base[k];
        c.maxRaces = depth;
        var r = runSession(c, function () { return seq[i++]; }, false);
        EP += prob * r.profit; EW += prob * r.wagered;
      }
      return { EP: EP, EW: EW, theory: -edgeOf(base.p, base.odds) * EW };
    }
    [['win', 3.0], ['place', 1.5], ['boat3', 20.0], ['trifecta', 40.0]].forEach(function (tk) {
      var t = TICKETS[tk[0]], odds = tk[1], p = autoP(t.R, odds);
      Object.keys(SYSTEMS).forEach(function (k) {
        var e = exactEV({
          system: k, ticket: tk[0], R: t.R, odds: odds, p: p,
          bankroll: 1e9, base: 1000, ratio: 5, betMax: 1e9, target: 0
        }, 8);
        var rel = Math.abs(e.EP - e.theory) / Math.max(1, Math.abs(e.theory));
        ok('期待値の同一性（厳密・8レース全列挙）[' + t.name.split('（')[0] + ' o=' + odds + ' / ' + SYSTEMS[k].name.split('（')[0] + ']',
          rel < 1e-9, 'E[収支] ' + e.EP.toFixed(4) + ' / −控除率×E[総ベット] ' + e.theory.toFixed(4));
      });
    });

    /* 9) 控除率0%（払戻率100%）なら期待値も0＝負ける原因は賭け方ではなく控除率 */
    (function () {
      var c = { system: 'double', ticket: 'fair', R: 1, odds: 2.0, p: 0.5, bankroll: 100000, base: 1000, ratio: 5, betMax: 50000, maxRaces: 100, target: 0 };
      var r = runBatch(c, 20260902, 5000);
      ok('控除率0%なら平均収支もほぼ0', Math.abs(r.mean) < 1500, '平均 ' + Math.round(r.mean) + ' 円');
      ok('控除率0%でも破綻はゼロにならない（資金が有限だから）', r.busts > 0, '破綻 ' + r.busts + ' / 5000');
    })();

    /* 10) 実測の回収率は払戻率に寄る（平均的な買い方をしている場合） */
    (function () {
      var c = { system: 'flat', ticket: 'win', R: 0.8, odds: 3.0, p: autoP(0.8, 3), bankroll: 1e9, base: 1000, ratio: 5, betMax: 1e9, maxRaces: 500, target: 0 };
      var r = runBatch(c, 31337, 2000);
      ok('定額で1,000,000レース回すと回収率が払戻率80%に寄る', Math.abs(r.recovery - 0.8) < 0.01,
        '実測 ' + (r.recovery * 100).toFixed(2) + '% / 払戻率 80.00%');
    })();

    /* 11) 🔴 非同期・共有DOMの不変条件 */
    (function () {
      if (!T) { out.push('SKIP  非同期・共有DOMの不変条件（このページにシミュレーターが無い）'); return; }
      T.switchView('play'); T.newSession(); T.startAuto();
      var staleToken = T.getState().autoToken;
      var before = T.getState().session.races;
      T.switchView('batch');
      ok('画面切替でタイマーが確実に破棄される', T.getState().autoTimer === null);
      T.tickAuto(staleToken);
      ok('古いコールバックはセッションを進めない', T.getState().session.races === before,
        '(' + before + ' → ' + T.getState().session.races + ')');
      ok('古いコールバックは他画面のDOMを書き換えない',
        T.getState().view === 'batch' && T.panel.querySelector('.hist') === null);
      T.switchView('play');
    })();

    /* 12) 表示と内部状態の一致 */
    (function () {
      if (!T) { out.push('SKIP  表示と内部状態の一致（このページにシミュレーターが無い）'); return; }
      T.switchView('play'); T.newSession();
      for (var i = 0; i < 7; i++) T.stepOnce();
      T.renderPlay();
      var st = T.getState().session;
      var want = st.over && st.needed ? st.needed : T.nextBetOf();
      var vs = T.panel.querySelectorAll('.stat .v');
      var shownBet = parseInt(vs[2].textContent.replace(/[^0-9]/g, ''), 10);
      var shownBank = parseInt(vs[0].textContent.replace(/[^0-9-]/g, ''), 10);
      ok('表示された賭け金＝内部状態の賭け金', shownBet === want, '表示 ' + shownBet + ' / 内部 ' + want);
      ok('表示された資金＝内部状態の資金', shownBank === Math.round(st.bank), '表示 ' + shownBank + ' / 内部 ' + Math.round(st.bank));
      ok('的中/不的中の表示件数＝実際に進んだレース数', T.panel.querySelectorAll('.pip').length === Math.min(24, st.races));
    })();

    /* 13) 連打・二重起動しても走る自動再生は1本だけ */
    (function () {
      if (!T) { out.push('SKIP  自動再生の二重起動対策（このページにシミュレーターが無い）'); return; }
      T.switchView('play'); T.newSession();
      T.startAuto(); var t1 = T.getState().autoToken;
      T.startAuto(); var t2 = T.getState().autoToken;
      ok('自動再生の二重起動を潰している', t1 !== t2);
      T.tickAuto(t1);
      ok('潰された1本目は何もしない', T.getState().session.races === 0);
      T.stopAuto(); T.renderPlay();
    })();

    /* 14) 控除率の壁 計算機（このページにあるときだけ） */
    (function () {
      var wall = document.getElementById('wall');
      if (!wall || !wall.__testWall) { out.push('SKIP  控除率の壁 計算機（このページには無い）'); return; }
      document.getElementById('w-fund').value = '100000';
      document.getElementById('w-r').value = '75';
      document.getElementById('w-n').value = '10';
      wall.__testWall.render();
      var v = wall.__testWall.out.querySelectorAll('.stat .v')[0].textContent.replace(/[^0-9]/g, '');
      ok('控除率の壁：10万円・払戻率75%・10回転で残るのは 5,631 円', v === '5631', '表示 ' + v);
    })();

    var box = document.createElement('pre');
    box.id = 'selftest';
    box.textContent = '=== 自己テスト：公営競技シミュレーター ===\n' + out.join('\n') +
      '\n\n合計 ' + (pass + fail) + ' 件 ／ PASS ' + pass + ' ／ FAIL ' + fail;
    root.parentNode.insertBefore(box, root);
  }

  /* ---------------------------------------------------------------- 起動 */
  document.addEventListener('DOMContentLoaded', function () {
    var wall = document.getElementById('wall');
    if (wall) bootWall(wall);
    var sim = document.getElementById('sim');
    if (sim) boot(sim);
    var root = sim || wall;
    if (!root) return;
    if (location.hash === '#selftest' || location.search.indexOf('selftest=1') >= 0) {
      try { selfTest(root); }
      catch (e) {
        var box = document.createElement('pre');
        box.id = 'selftest';
        box.textContent = '自己テストが例外で停止しました: ' + ((e && e.stack) || e);
        root.parentNode.insertBefore(box, root);
      }
    }
  });

  window.KoeiLab = {
    TICKETS: TICKETS, SYSTEMS: SYSTEMS, runSession: runSession, runBatch: runBatch,
    mulberry32: mulberry32, autoP: autoP, edgeOf: edgeOf, roundBet: roundBet
  };
})();
