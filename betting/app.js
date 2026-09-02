/* ============================================================================
   勝負ラボ ベッティングシステム検証室 — シミュレーションエンジン + UI
   ---------------------------------------------------------------------------
   設計方針
   - 期待値は「総ベット額 × 控除率」でしか動かない。ベット額の決め方（＝システム）
     は期待値を一切変えない。このコードはその事実を実測で見せるためのもの。
   - 非同期は「自動再生の setTimeout」1本だけ。ハンドル(autoTimer)と世代番号
     (autoToken)を必ず持ち、設定変更・タブ切替・リセットで停止＋完全再描画する。
     コールバック先頭で世代とモードをガードする。
   - 結果は自動で消さない・自動で流さない。自動再生は既定OFF、明示操作でのみ動く。
   - #selftest を付けて開くと、表示と内部状態の不変条件を検証する自己テストが走る。
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- PRNG */
  // mulberry32: シード固定で完全に再現できる決定的な擬似乱数
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* --------------------------------------------------------------- ゲーム */
  // edge = -(pWin*payout - pLose) ＝ 1ベットあたりの期待損失率（＝控除率）
  var GAMES = {
    euro:   { name: 'ヨーロピアンルーレット 赤/黒（1:1）', pWin: 18 / 37, pPush: 0, payout: 1 },
    amer:   { name: 'アメリカンルーレット 赤/黒（1:1）',   pWin: 18 / 38, pPush: 0, payout: 1 },
    bacc:   { name: 'バカラ バンカー（0.95:1・引分は返却）', pWin: 0.458597, pPush: 0.095156, payout: 0.95 },
    coin:   { name: '公正なコイン（控除率0%・対照実験用）', pWin: 0.5, pPush: 0, payout: 1 },
    dozen:  { name: 'ヨーロピアンルーレット ダズン（2:1）', pWin: 12 / 37, pPush: 0, payout: 2 },
    dozenA: { name: 'アメリカンルーレット ダズン（2:1）',   pWin: 12 / 38, pPush: 0, payout: 2 }
  };
  Object.keys(GAMES).forEach(function (k) {
    var g = GAMES[k];
    g.pLose = 1 - g.pWin - g.pPush;
    g.edge = -(g.pWin * g.payout - g.pLose); // 正の値＝控除率
  });

  /* ------------------------------------------------------------- システム */
  // 各システムは「次のベット額をどう決めるか」だけを担当する。
  // 勝敗の確率にも配当にも一切触れない＝だから期待値を変えられない。
  // 使う設定は c.base（基準額）と c.winTarget（パーレーの連勝目標）だけ。
  var SYSTEMS = {
    martingale: {
      name: 'マーチンゲール法', payout: 1,
      init: function (s) { s.step = 0; },
      bet: function (s, c) { return c.base * Math.pow(2, s.step); },
      result: function (s, c, o) { if (o === 'win') s.step = 0; else if (o === 'lose') s.step++; },
      state: function (s) { return '連敗数 ' + s.step + '／次の賭け金は基準額の ' + Math.pow(2, s.step) + ' 倍'; }
    },
    montecarlo: {
      name: 'モンテカルロ法', payout: 'any',
      init: function (s, c) { s.seq = [c.base, c.base * 2, c.base * 3]; },
      bet: function (s, c) {
        if (s.seq.length === 0) s.seq = [c.base, c.base * 2, c.base * 3];
        if (s.seq.length === 1) return s.seq[0];
        return s.seq[0] + s.seq[s.seq.length - 1];
      },
      // 勝ったときに両端から何個ずつ消すかは配当で決まる。
      // 1:1 なら1個ずつ、2:1 なら2個ずつ。こうしないと帳尻が合わない
      // （2:1 で1個ずつしか消さないと、数列の長さが平均で増え続けて発散する）。
      removeCount: function (c) { return Math.max(1, Math.round(GAMES[c.game].payout)); },
      result: function (s, c, o, bet) {
        if (o === 'win') {
          var k = SYSTEMS.montecarlo.removeCount(c);
          if (s.seq.length <= 2 * k) s.seq = [c.base, c.base * 2, c.base * 3]; // 数列が消えた＝1サイクル完了
          else { s.seq.splice(0, k); s.seq.splice(s.seq.length - k, k); }
        } else if (o === 'lose') { s.seq.push(bet); }
      },
      state: function (s, c) {
        return '数列 [' + s.seq.map(function (v) { return v.toLocaleString('ja-JP'); }).join(', ') +
          ']（両端の和が次の賭け金／勝ったら両端を' + SYSTEMS.montecarlo.removeCount(c) + '個ずつ削除）';
      }
    },
    dalembert: {
      name: 'ダランベール法', payout: 1,
      init: function (s) { s.level = 0; },
      bet: function (s, c) { return c.base * (1 + s.level); },
      result: function (s, c, o) {
        if (o === 'win') s.level = Math.max(0, s.level - 1);
        else if (o === 'lose') s.level++;
      },
      state: function (s) { return '段階 +' + s.level + '／次の賭け金は基準額の ' + (1 + s.level) + ' 倍'; }
    },
    paroli: {
      name: 'パーレー法（逆マーチンゲール）', payout: 1,
      init: function (s) { s.streak = 0; },
      bet: function (s, c) { return c.base * Math.pow(2, s.streak); },
      result: function (s, c, o) {
        if (o === 'win') { s.streak++; if (s.streak >= (c.winTarget || 3)) s.streak = 0; }
        else if (o === 'lose') s.streak = 0;
      },
      state: function (s, c) {
        return '連勝数 ' + s.streak + ' / ' + (c.winTarget || 3) + '／次の賭け金は基準額の ' + Math.pow(2, s.streak) + ' 倍';
      }
    },
    cocomo: {
      name: 'ココモ法', payout: 2,
      init: function (s) { s.hist = []; },
      bet: function (s, c) {
        var n = s.hist.length;
        return n < 2 ? c.base : s.hist[n - 1] + s.hist[n - 2];
      },
      result: function (s, c, o, bet) {
        if (o === 'win') s.hist = [];
        else if (o === 'lose') s.hist.push(bet);
      },
      state: function (s) { return '連敗数 ' + s.hist.length + '（直前2回の賭け金の和が次の賭け金）'; }
    }
  };

  // システムが使えるゲーム（配当条件で絞る）。バカラ(0.95:1)は1:1系に含める。
  function gamesFor(sysKey) {
    var need = SYSTEMS[sysKey].payout;
    return Object.keys(GAMES).filter(function (k) {
      var p = GAMES[k].payout;
      if (need === 'any') return true;
      if (need === 1) return p > 0.9 && p < 1.0001;
      return p === need;
    });
  }

  /* ------------------------------------------------------ 1セッション実行 */
  // 純関数。DOMにも時間にも依存しないのでそのままテストできる。
  // cfg: {system, game, bankroll, base, tableMax, maxRounds, target(利益目標/0で無効), winTarget}
  function runSession(cfg, rng, keepPath) {
    var g = GAMES[cfg.game], sys = SYSTEMS[cfg.system];
    var s = {}; sys.init(s, cfg);
    var bank = cfg.bankroll, wagered = 0, rounds = 0, wins = 0, curLose = 0, maxLose = 0;
    var ruin = null, needed = 0, path = keepPath ? [bank] : null, hist = keepPath ? [] : null;
    while (rounds < cfg.maxRounds) {
      var bet = Math.round(sys.bet(s, cfg));
      if (bet > cfg.tableMax) { ruin = 'limit'; needed = bet; break; }
      if (bet > bank) { ruin = 'fund'; needed = bet; break; }
      var r = rng(), o;
      if (r < g.pWin) o = 'win';
      else if (r < g.pWin + g.pPush) o = 'push';
      else o = 'lose';
      rounds++; wagered += bet;
      if (o === 'win') { bank += bet * g.payout; wins++; curLose = 0; }
      else if (o === 'lose') { bank -= bet; curLose++; if (curLose > maxLose) maxLose = curLose; }
      sys.result(s, cfg, o, bet);
      if (keepPath) { path.push(bank); hist.push({ bet: bet, o: o, bank: bank }); }
      if (cfg.target > 0 && bank - cfg.bankroll >= cfg.target) break;
    }
    return {
      bank: bank, profit: bank - cfg.bankroll, wagered: wagered, rounds: rounds, wins: wins,
      maxLose: maxLose, ruin: ruin, needed: needed, path: path, hist: hist,
      reachedTarget: cfg.target > 0 && bank - cfg.bankroll >= cfg.target
    };
  }

  /* --------------------------------------------------------- 一括試行統計 */
  function runBatch(cfg, seed, n) {
    var rng = seed == null ? Math.random : mulberry32(seed);
    var profits = [], busts = 0, plus = 0, wagered = 0, rounds = 0, paths = [], tgt = 0;
    for (var i = 0; i < n; i++) {
      var res = runSession(cfg, rng, i < 24);
      profits.push(res.profit);
      if (res.ruin) busts++;
      if (res.profit > 0) plus++;
      if (res.reachedTarget) tgt++;
      wagered += res.wagered; rounds += res.rounds;
      if (i < 24) paths.push(res.path);
    }
    var sorted = profits.slice().sort(function (a, b) { return a - b; });
    var sum = profits.reduce(function (a, b) { return a + b; }, 0);
    return {
      n: n, sorted: sorted, busts: busts, plus: plus, target: tgt, sum: sum, mean: sum / n,
      median: sorted[Math.floor(n / 2)], worst: sorted[0], best: sorted[n - 1],
      meanWagered: wagered / n, meanRounds: rounds / n, paths: paths,
      theory: -GAMES[cfg.game].edge * (wagered / n), cfg: cfg
    };
  }

  /* -------------------------------------------------------------- 表示系 */
  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function sgn(n) { return (Math.round(n) > 0 ? '+' : '') + fmt(n); }
  function pct(x) { return (x * 100).toFixed(x * 100 < 10 ? 2 : 1) + '%'; }
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
    sorted.forEach(function (v) {
      counts[Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins))]++;
    });
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
    var defaultGame = root.getAttribute('data-game') || null;

    /* --- このシミュレータが所有する状態 --- */
    var view = 'play';      // 'play' | 'batch'
    var session = null;     // 進行中の1セッション
    var autoTimer = null;   // 自動再生のタイマーハンドル（常に1本まで）
    var autoToken = 0;      // 世代番号。停止のたびに進めて古いコールバックを無効化する
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
      addField('f-system', 'ベッティングシステム',
        '<select id="f-system">' + Object.keys(SYSTEMS).map(function (k) {
          return '<option value="' + k + '">' + SYSTEMS[k].name + '</option>';
        }).join('') + '</select>');
    }
    addField('f-game', 'ゲーム（控除率つき）', '<select id="f-game"></select>',
      '控除率＝1ベットあたりの期待損失率。これがゼロでない限り、賭け方を変えても期待値は戻らない');
    addField('f-bankroll', '初期資金（仮想・円）', '<input id="f-bankroll" type="number" inputmode="numeric" min="100" step="1000" value="100000">');
    addField('f-base', 'ベース賭け金（仮想・円）', '<input id="f-base" type="number" inputmode="numeric" min="1" step="100" value="1000">');
    addField('f-tablemax', 'テーブル上限（仮想・円）', '<input id="f-tablemax" type="number" inputmode="numeric" min="1" step="1000" value="20000">',
      '実在のテーブルには必ず上限がある。これを超える賭け金が必要になった時点で「続行不能」＝破綻');
    addField('f-rounds', '1セッションの最大ゲーム数', '<input id="f-rounds" type="number" inputmode="numeric" min="1" max="5000" step="10" value="200">');
    addField('f-target', '利益目標に届いたらやめる（0で無効）', '<input id="f-target" type="number" inputmode="numeric" min="0" step="1000" value="0">',
      '「やめ時を決めれば勝てる」のかどうかも、ここを設定すれば試せる');
    var pf = addField('f-paroli', 'パーレー：何連勝で利確するか', '<input id="f-paroli" type="number" inputmode="numeric" min="2" max="8" step="1" value="3">');
    addField('f-runs', '一括試行のセッション数', '<select id="f-runs"><option value="200">200</option><option value="1000" selected>1,000</option><option value="5000">5,000</option></select>');
    addField('f-seed', '乱数シード（空欄＝毎回ランダム）', '<input id="f-seed" type="number" inputmode="numeric" step="1" placeholder="例: 20260902">',
      '同じ数字を入れれば何度でも同じ結果を再現できる');
    root.appendChild(fields);

    var tabs = el('div', 'tabs');
    var tabPlay = el('button', 'active', '1回プレイ');
    var tabBatch = el('button', null, '一括試行');
    tabs.appendChild(tabPlay); tabs.appendChild(tabBatch);
    root.appendChild(tabs);

    var panel = el('div');
    root.appendChild(panel);

    var $ = function (id) { return document.getElementById(id); };
    var selSystem = lockedSystem ? null : $('f-system');
    var selGame = $('f-game');

    function fillGames() {
      var keys = gamesFor(lockedSystem || selSystem.value);
      var prev = selGame.value;
      selGame.innerHTML = keys.map(function (k) {
        return '<option value="' + k + '">' + GAMES[k].name + '｜控除率 ' + (GAMES[k].edge * 100).toFixed(2) + '%</option>';
      }).join('');
      if (keys.indexOf(prev) >= 0) selGame.value = prev;
      else if (defaultGame && keys.indexOf(defaultGame) >= 0) selGame.value = defaultGame;
    }
    fillGames();
    pf.style.display = (lockedSystem || selSystem.value) === 'paroli' ? '' : 'none';

    function cfg() {
      var num = function (id, d) { var v = parseFloat($(id).value); return isFinite(v) ? v : d; };
      return {
        system: lockedSystem || selSystem.value,
        game: selGame.value,
        bankroll: Math.max(1, num('f-bankroll', 100000)),
        base: Math.max(1, num('f-base', 1000)),
        tableMax: Math.max(1, num('f-tablemax', 20000)),
        maxRounds: Math.min(5000, Math.max(1, num('f-rounds', 200))),
        target: Math.max(0, num('f-target', 0)),
        winTarget: Math.max(2, Math.min(8, num('f-paroli', 3))),
        runs: parseInt($('f-runs').value, 10) || 1000,
        seedRaw: ($('f-seed').value || '').trim()
      };
    }
    // シードは入力値をそのまま使う（解説ページに載せた数字を画面で再現できるように）
    function seedOf(c) {
      if (c.seedRaw === '') return null;
      var s = parseInt(c.seedRaw, 10);
      return isFinite(s) ? (s >>> 0) : null;
    }

    /* ------------------------------------------ 自動再生（唯一の非同期処理） */
    function stopAuto() {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      autoToken++;   // これ以降、古い世代のコールバックは全て無効
    }
    function tickAuto(token) {
      if (token !== autoToken) return;                        // 世代ガード
      if (view !== 'play' || !session || session.over) { stopAuto(); renderPlay(); return; }
      stepOnce();
      renderPlay();
      if (session.over) { stopAuto(); renderPlay(); return; }
      autoTimer = setTimeout(function () { tickAuto(token); }, 700);
    }
    function startAuto() {
      stopAuto();                                             // 二重起動を必ず潰す
      var token = autoToken;
      autoTimer = setTimeout(function () { tickAuto(token); }, 700);
      renderPlay();
    }

    /* ------------------------------------------------------------ 1回プレイ */
    function newSession() {
      stopAuto();
      var c = cfg();
      var sd = seedOf(c);
      session = {
        cfg: c, sys: SYSTEMS[c.system], s: {},
        rng: sd == null ? Math.random : mulberry32(sd),
        bank: c.bankroll, wagered: 0, rounds: 0, curLose: 0, maxLose: 0,
        path: [c.bankroll], hist: [], over: false, ruin: null, needed: 0, hitTarget: false
      };
      session.sys.init(session.s, c);
      renderPlay();
    }

    function stepOnce() {
      if (!session || session.over) return;
      var c = session.cfg, g = GAMES[c.game], sys = session.sys;
      var bet = Math.round(sys.bet(session.s, c));
      if (bet > c.tableMax) { session.over = true; session.ruin = 'limit'; session.needed = bet; return; }
      if (bet > session.bank) { session.over = true; session.ruin = 'fund'; session.needed = bet; return; }
      var r = session.rng(), o;
      if (r < g.pWin) o = 'win'; else if (r < g.pWin + g.pPush) o = 'push'; else o = 'lose';
      session.rounds++; session.wagered += bet;
      if (o === 'win') { session.bank += bet * g.payout; session.curLose = 0; }
      else if (o === 'lose') { session.bank -= bet; session.curLose++; if (session.curLose > session.maxLose) session.maxLose = session.curLose; }
      sys.result(session.s, c, o, bet);
      session.path.push(session.bank);
      session.hist.push({ bet: bet, o: o, bank: session.bank });
      if (c.target > 0 && session.bank - c.bankroll >= c.target) { session.over = true; session.hitTarget = true; }
      else if (session.rounds >= c.maxRounds) { session.over = true; }
    }

    // 所有する要素を毎回まるごと作り直す（部分更新をしない＝表示と内部状態がズレない）
    function renderPlay() {
      if (view !== 'play') return;
      panel.innerHTML = '';
      if (!session) {
        panel.appendChild(el('div', 'msg', '設定を決めて「セッション開始」を押してください。1ゲームずつ手で進みます（自動再生は任意）。'));
        var row0 = el('div', 'btnrow');
        var b0 = el('button', 'primary', 'セッション開始'); b0.onclick = newSession;
        row0.appendChild(b0); panel.appendChild(row0);
        return;
      }
      var c = session.cfg, g = GAMES[c.game], sys = session.sys;
      var nextBet = session.over && session.needed ? session.needed : Math.round(sys.bet(session.s, c));
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
      stat(session.rounds + ' 回', 'ゲーム数（最大 ' + c.maxRounds + '）');
      panel.appendChild(stats);

      panel.appendChild(el('div', 'seqbox', sys.state(session.s, c)));

      var hist = el('div', 'hist');
      if (session.hist.length === 0) hist.appendChild(el('small', null, '（まだ1ゲームも進んでいません）'));
      session.hist.slice(-24).forEach(function (h) {
        hist.appendChild(el('div', 'pip ' + (h.o === 'win' ? 'w' : h.o === 'lose' ? 'l' : 'p'),
          h.o === 'win' ? '勝' : h.o === 'lose' ? '負' : '分'));
      });
      panel.appendChild(hist);

      var cw = document.createElement('div');
      cw.innerHTML = lineChart([session.path], c.bankroll);
      panel.appendChild(cw.firstChild);
      panel.appendChild(el('div', 'legend', '点線＝初期資金 ' + fmt(c.bankroll) + ' 円。線が点線より下なら負け越しです。'));

      var msg;
      if (session.over && session.ruin === 'limit') {
        msg = el('div', 'msg bust');
        msg.innerHTML = '<b>破綻：テーブル上限で続行不能</b><br>次に必要な賭け金は <b>' + fmt(session.needed) +
          ' 円</b>ですが、テーブル上限は ' + fmt(c.tableMax) + ' 円です。ここで <b>' + sgn(prof) + ' 円</b>が確定します。' +
          '<br><small>「勝つまで賭け金を増やす」は、上限がある限り必ずここに行き着きます。</small>';
      } else if (session.over && session.ruin === 'fund') {
        msg = el('div', 'msg bust');
        msg.innerHTML = '<b>破綻：資金不足で続行不能</b><br>次に必要な賭け金 <b>' + fmt(session.needed) +
          ' 円</b>に対し、手元は ' + fmt(session.bank) + ' 円しかありません。<b>' + sgn(prof) + ' 円</b>が確定します。';
      } else if (session.over && session.hitTarget) {
        msg = el('div', 'msg done');
        msg.innerHTML = '<b>利益目標に届いたので終了しました（' + sgn(prof) + ' 円）。</b><br>' +
          '<small>1セッションで勝つのは難しくありません。問題は「同じことを何百回も繰り返したらどうなるか」です。上のタブの一括試行で確かめてください。</small>';
      } else if (session.over) {
        msg = el('div', 'msg done');
        msg.innerHTML = '<b>最大ゲーム数に到達して終了。収支 ' + sgn(prof) + ' 円</b>／総ベット額 ' + fmt(session.wagered) + ' 円。' +
          '<br><small>理論上の期待収支＝−控除率 ' + (g.edge * 100).toFixed(2) + '% × 総ベット額 ＝ <b>' +
          sgn(-g.edge * session.wagered) + ' 円</b></small>';
      } else {
        msg = el('div', 'msg');
        msg.innerHTML = '総ベット額 ' + fmt(session.wagered) + ' 円／最大連敗 ' + session.maxLose +
          '。ここまでの理論上の期待収支は <b>' + sgn(-g.edge * session.wagered) + ' 円</b>です。';
      }
      panel.appendChild(msg);

      var row = el('div', 'btnrow');
      var b1 = el('button', 'primary', '次の1ゲーム'); b1.disabled = session.over;
      b1.onclick = function () { stopAuto(); stepOnce(); renderPlay(); };
      var b10 = el('button', null, '10ゲーム進む'); b10.disabled = session.over;
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
          if (view !== 'batch') return;   // 途中でタブが変わっていたら結果を捨てる
          var c = cfg();
          lastBatch = runBatch(c, seedOf(c), c.runs);
          renderBatch(false);
        }, 30);
      };
      row.appendChild(b);
      panel.appendChild(row);

      if (!lastBatch) {
        panel.appendChild(el('div', 'msg',
          '同じ設定のセッションを何百回・何千回とまとめて回して、破綻率・最終収支の分布・期待値との一致を見ます。結果は自動で消えません。'));
        return;
      }
      var r = lastBatch, c2 = r.cfg, g = GAMES[c2.game];

      var stats = el('div', 'stats');
      function stat(v, l, cls) {
        var d = el('div', 'stat');
        d.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), v));
        d.appendChild(el('div', 'l', l));
        stats.appendChild(d);
      }
      stat(pct(r.plus / r.n), 'プラスで終わった割合', 'pos');
      stat(pct(r.busts / r.n), '破綻した割合', 'neg');
      stat(sgn(r.mean), '1セッションの平均収支', r.mean >= 0 ? 'pos' : 'neg');
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
        tr('破綻（資金・上限で続行不能）', r.busts.toLocaleString('ja-JP') + ' 回（' + pct(r.busts / r.n) + '）') +
        (c2.target > 0 ? tr('利益目標に到達', r.target.toLocaleString('ja-JP') + ' 回（' + pct(r.target / r.n) + '）') : '') +
        tr('収支の中央値', sgn(r.median) + ' 円') +
        tr('最良のセッション', sgn(r.best) + ' 円', 'good') +
        tr('最悪のセッション', sgn(r.worst) + ' 円', 'bad') +
        tr('平均ゲーム数', r.meanRounds.toFixed(1) + ' 回') +
        tr('平均の総ベット額', fmt(r.meanWagered) + ' 円') +
        tr('理論値：−控除率 × 平均総ベット額', sgn(r.theory) + ' 円', 'bad') +
        tr('実測：平均収支', sgn(r.mean) + ' 円', 'bad') +
        tr('理論値との差（誤差）', sgn(r.mean - r.theory) + ' 円') +
        '</tbody></table>';
      panel.appendChild(tb);

      var plusPct = r.plus / r.n;
      var read = el('div', 'readme');
      read.innerHTML = '<h3>この結果の読み方</h3>' +
        '<p><b>' + r.n.toLocaleString('ja-JP') + ' セッション中 ' + r.plus.toLocaleString('ja-JP') + ' 回（' + pct(plusPct) +
        '）がプラスで終わりました。</b>' + (plusPct > 0.6 ? 'ぱっと見は「勝てている」ように見えます。' : '') +
        'それでも合計収支は <b>' + sgn(r.sum) + ' 円</b>です。' +
        (plusPct > 0.6 ? '小さな勝ちを何度も積み上げ、たまに来る大きな負けでそれを全部返している——それがこのヒストグラムの形です。' : '') + '</p>' +
        '<p>そして重要なのは表の下3行です。<b>実測の平均収支 ' + sgn(r.mean) + ' 円</b>は、' +
        '<b>−控除率 ' + (g.edge * 100).toFixed(2) + '% × 平均総ベット額 ' + fmt(r.meanWagered) + ' 円 ＝ ' + sgn(r.theory) + ' 円</b>' +
        ' とほぼ一致します。賭け方をどう工夫しても、期待される損失は「賭けた総額 × 控除率」に吸い寄せられます。' +
        (g.edge === 0
          ? 'なお今回は控除率0%のゲームなので期待値はちょうど0です。それでも破綻がゼロにならないことに注目してください（資金とテーブル上限が有限だからです）。'
          : '差が残るのは試行回数が有限だからで、増やすほど小さくなります。') + '</p>';
      panel.appendChild(read);
    }

    /* -------------------------------------------------------- タブ・イベント */
    function switchView(v) {
      stopAuto();                 // 画面を離れる時は必ず非同期を止める
      view = v;
      tabPlay.className = v === 'play' ? 'active' : '';
      tabBatch.className = v === 'batch' ? 'active' : '';
      panel.innerHTML = '';       // 所有要素を全消去してから作り直す（部分更新しない）
      if (v === 'play') renderPlay(); else renderBatch(false);
    }
    tabPlay.onclick = function () { switchView('play'); };
    tabBatch.onclick = function () { switchView('batch'); };

    // 設定が変わったら自動再生を止め、セッションと結果を破棄して完全に描き直す
    function onSettingChange() {
      stopAuto();
      session = null; lastBatch = null;
      if (!lockedSystem) { fillGames(); pf.style.display = selSystem.value === 'paroli' ? '' : 'none'; }
      panel.innerHTML = '';
      if (view === 'play') renderPlay(); else renderBatch(false);
    }
    Array.prototype.forEach.call(root.querySelectorAll('input,select'), function (n) {
      n.addEventListener('change', onSettingChange);
    });

    renderPlay();

    root.__test = {
      getState: function () { return { view: view, session: session, autoTimer: autoTimer, autoToken: autoToken }; },
      stopAuto: stopAuto, startAuto: startAuto, tickAuto: tickAuto,
      newSession: newSession, stepOnce: stepOnce, renderPlay: renderPlay,
      switchView: switchView, panel: panel, cfg: cfg
    };
  }

  /* ============================================================= 自己テスト */
  function selfTest(root) {
    var out = [], pass = 0, fail = 0;
    function ok(name, cond, extra) {
      (cond ? (pass++, out.push('PASS  ' + name + (extra ? '  ' + extra : '')))
            : (fail++, out.push('FAIL  ' + name + (extra ? '  ' + extra : ''))));
    }
    var T = root.__test;

    /* 1) 進行ルールの単体検証（勝敗を固定して賭け金の並びを確かめる） */
    function prog(sysKey, outcomes, c) {
      var s = {}, bets = [], sys = SYSTEMS[sysKey];
      sys.init(s, c);
      outcomes.forEach(function (o) { var b = sys.bet(s, c); bets.push(b); sys.result(s, c, o, b); });
      return JSON.stringify(bets);
    }
    var C = { base: 1000, winTarget: 3, game: 'euro' };
    var C2 = { base: 1000, winTarget: 3, game: 'dozen' };
    ok('マーチンゲール：負け続けで倍々', prog('martingale', ['lose', 'lose', 'lose', 'lose'], C) === '[1000,2000,4000,8000]');
    ok('マーチンゲール：勝ったら基準額に戻る', prog('martingale', ['lose', 'lose', 'win', 'lose'], C) === '[1000,2000,4000,1000]');
    ok('ダランベール：負けで+1段・勝ちで-1段', prog('dalembert', ['lose', 'lose', 'win', 'win', 'win'], C) === '[1000,2000,3000,2000,1000]');
    ok('パーレー：3連勝で基準額に戻る', prog('paroli', ['win', 'win', 'win', 'win'], C) === '[1000,2000,4000,1000]');
    ok('パーレー：1回負けたら即リセット', prog('paroli', ['win', 'lose', 'win'], C) === '[1000,2000,1000]');
    ok('ココモ：直前2回の和（1,1,2,3,5,8）', prog('cocomo', ['lose', 'lose', 'lose', 'lose', 'lose', 'lose'], C) === '[1000,1000,2000,3000,5000,8000]');
    ok('モンテカルロ(1:1)：負けで末尾追加・勝ちで両端1個ずつ削除', prog('montecarlo', ['lose', 'win', 'win'], C) === '[4000,5000,5000]');
    ok('モンテカルロ(2:1)：勝ちで両端2個ずつ削除', prog('montecarlo', ['lose', 'win', 'win'], C2) === '[4000,5000,4000]');

    /* 2) 会計が合う：資金推移の終点＝最終収支 */
    (function () {
      var c = { system: 'martingale', game: 'euro', bankroll: 1000000, base: 1000, tableMax: 1e9, maxRounds: 300, target: 0, winTarget: 3 };
      var r = runSession(c, mulberry32(12345), true);
      var last = r.path[r.path.length - 1];
      ok('会計：資金推移の終点と最終収支が一致', Math.abs((last - c.bankroll) - r.profit) < 1e-6);
      var sum = r.hist.reduce(function (a, h) { return a + (h.o === 'win' ? h.bet * GAMES.euro.payout : h.o === 'lose' ? -h.bet : 0); }, 0);
      ok('会計：1ゲームごとの増減の総和と最終収支が一致', Math.abs(sum - r.profit) < 1e-6);
    })();

    /* 3) 再現性：同じシードなら完全に同じ結果 */
    (function () {
      var c = { system: 'montecarlo', game: 'euro', bankroll: 200000, base: 1000, tableMax: 50000, maxRounds: 200, target: 0, winTarget: 3 };
      var a = runSession(c, mulberry32(777), false), b = runSession(c, mulberry32(777), false);
      ok('再現性：同一シードで同一結果', a.profit === b.profit && a.rounds === b.rounds);
    })();

    /* 4) 期待値の同一性を「厳密に」検証する。
          乱数で平均を取ると分散が大きすぎて収束しないので、
          深さ d までの勝敗パターンを全列挙し、確率で重み付けした厳密な期待値を計算して
          E[収支] = −控除率 × E[総ベット額] が機械精度で成り立つことを確かめる。 */
    function exactEV(base, depth) {
      var g = GAMES[base.game];
      var outs = g.pPush > 0
        ? [[g.pWin, 0], [g.pPush, g.pWin + g.pPush / 2], [g.pLose, 1 - 1e-9]]
        : [[g.pWin, 0], [g.pLose, 1 - 1e-9]];
      var m = outs.length, total = Math.pow(m, depth), EP = 0, EW = 0;
      for (var n = 0; n < total; n++) {
        var t = n, prob = 1, seq = [];
        for (var d = 0; d < depth; d++) { var o = outs[t % m]; t = Math.floor(t / m); prob *= o[0]; seq.push(o[1]); }
        var i = 0;
        var c = {}; for (var key in base) c[key] = base[key];
        c.maxRounds = depth;
        var r = runSession(c, function () { return seq[i++]; }, false);
        EP += prob * r.profit; EW += prob * r.wagered;
      }
      return { EP: EP, EW: EW, theory: -g.edge * EW };
    }
    Object.keys(SYSTEMS).forEach(function (k) {
      var game = SYSTEMS[k].payout === 2 ? 'dozen' : 'euro';
      var e = exactEV({ system: k, game: game, bankroll: 1e12, base: 1000, tableMax: 1e12, target: 0, winTarget: 3 }, 8);
      var rel = Math.abs(e.EP - e.theory) / Math.max(1, Math.abs(e.theory));
      ok('期待値の同一性（厳密・8ゲーム全列挙）[' + SYSTEMS[k].name + ']', rel < 1e-9,
        'E[収支] ' + e.EP.toFixed(4) + ' / −控除率×E[総ベット] ' + e.theory.toFixed(4));
    });
    (function () {
      var e = exactEV({ system: 'martingale', game: 'bacc', bankroll: 1e12, base: 1000, tableMax: 1e12, target: 0, winTarget: 3 }, 7);
      var rel = Math.abs(e.EP - e.theory) / Math.max(1, Math.abs(e.theory));
      ok('期待値の同一性（厳密・引分のあるバカラ）', rel < 1e-9,
        'E[収支] ' + e.EP.toFixed(4) + ' / 理論 ' + e.theory.toFixed(4));
    })();

    /* 4b) 現実的な設定なら、乱数を回した平均も理論値に寄る */
    (function () {
      var c = { system: 'martingale', game: 'euro', bankroll: 100000, base: 1000, tableMax: 20000, maxRounds: 200, target: 0, winTarget: 3 };
      var r = runBatch(c, 20260902, 5000);
      ok('実測平均も理論値に近い（マーチン・上限あり5000回）',
        Math.abs(r.mean - r.theory) < Math.abs(r.theory) * 0.35,
        '実測 ' + Math.round(r.mean) + ' / 理論 ' + Math.round(r.theory));
    })();

    /* 5) 控除率0%なら期待値も0＝負けの原因はシステムではなく控除率 */
    (function () {
      var c = { system: 'martingale', game: 'coin', bankroll: 100000, base: 1000, tableMax: 20000, maxRounds: 200, target: 0, winTarget: 3 };
      var r = runBatch(c, 99, 4000);
      ok('控除率0%なら平均収支もほぼ0', Math.abs(r.mean) < 1200, '平均 ' + Math.round(r.mean) + ' 円');
    })();

    /* 6) 🔴 非同期・共有DOMの不変条件
          「自動再生中に画面を切り替えても、古いコールバックは新しい画面を壊さない」 */
    (function () {
      T.switchView('play'); T.newSession(); T.startAuto();
      var staleToken = T.getState().autoToken;
      var before = T.getState().session.rounds;
      T.switchView('batch');                       // 画面を離れる＝stopAuto されるはず
      ok('画面切替でタイマーが確実に破棄される', T.getState().autoTimer === null);
      T.tickAuto(staleToken);                      // 漏れたコールバックを手で発火させる
      ok('古いコールバックはセッションを進めない', T.getState().session.rounds === before,
        '(' + before + ' → ' + T.getState().session.rounds + ')');
      ok('古いコールバックは他画面のDOMを書き換えない', T.getState().view === 'batch' && T.panel.querySelector('.hist') === null);
      T.switchView('play');
    })();

    /* 7) 表示と内部状態の一致：画面の「次の賭け金」「手元の資金」＝エンジンの値 */
    (function () {
      T.switchView('play'); T.newSession();
      for (var i = 0; i < 7; i++) T.stepOnce();
      T.renderPlay();
      var st = T.getState().session;
      var want = st.over && st.needed ? st.needed : Math.round(SYSTEMS[st.cfg.system].bet(st.s, st.cfg));
      var vs = T.panel.querySelectorAll('.stat .v');
      var shownBet = parseInt(vs[2].textContent.replace(/[^0-9]/g, ''), 10);
      var shownBank = parseInt(vs[0].textContent.replace(/[^0-9-]/g, ''), 10);
      ok('表示された賭け金＝内部状態の賭け金', shownBet === want, '表示 ' + shownBet + ' / 内部 ' + want);
      ok('表示された資金＝内部状態の資金', shownBank === Math.round(st.bank), '表示 ' + shownBank + ' / 内部 ' + Math.round(st.bank));
      ok('勝敗表示の件数＝実際に進んだゲーム数', T.panel.querySelectorAll('.pip').length === Math.min(24, st.rounds));
    })();

    /* 8) 連打・二重起動しても走る自動再生は1本だけ */
    (function () {
      T.switchView('play'); T.newSession();
      T.startAuto(); var t1 = T.getState().autoToken;
      T.startAuto(); var t2 = T.getState().autoToken;
      ok('自動再生の二重起動を潰している', t1 !== t2);
      T.tickAuto(t1);
      ok('潰された1本目は何もしない', T.getState().session.rounds === 0);
      T.stopAuto(); T.renderPlay();
    })();

    var box = document.createElement('pre');
    box.id = 'selftest';
    box.textContent = '=== 自己テスト：表示と内部状態の不変条件 ===\n' + out.join('\n') +
      '\n\n合計 ' + (pass + fail) + ' 件 ／ PASS ' + pass + ' ／ FAIL ' + fail;
    root.parentNode.insertBefore(box, root);
  }

  /* ---------------------------------------------------------------- 起動 */
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('sim');
    if (!root) return;
    boot(root);
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

  window.BettingLab = { GAMES: GAMES, SYSTEMS: SYSTEMS, runSession: runSession, runBatch: runBatch, mulberry32: mulberry32 };
})();
