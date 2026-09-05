/* 勝負ラボ 還元率ラボ — ケリー基準の計算機
   g(f) = p*ln(1+b*f) + q*ln(1-f) / f* = (b*p - q)/b
   成長率ゼロ点は二分法で数値解。外部依存なし。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function g(f, p, b) {
    var q = 1 - p;
    if (f <= 0) return 0;
    if (f >= 1) return -Infinity;
    return p * Math.log(1 + b * f) + q * Math.log(1 - f);
  }

  function zeroPoint(p, b, fstar) {
    // f* より右側で g(f)=0 になる点を二分法で探す
    if (!(fstar > 0)) return null;
    var lo = fstar, hi = 0.999999;
    if (g(hi, p, b) > 0) return null; // 1未満では戻らない
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (g(mid, p, b) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 2 : d) + '%'; }

  function fmtMult(m) {
    if (!isFinite(m)) return '—';
    if (m >= 1e9) return '約 ' + m.toExponential(2) + ' 倍';
    if (m >= 100) return '約 ' + Math.round(m).toLocaleString('ja-JP') + ' 倍';
    if (m >= 0.01) return '約 ' + m.toFixed(2) + ' 倍';
    return '約 ' + m.toExponential(2) + ' 倍';
  }

  function run() {
    var p = parseFloat($('p').value) / 100;
    var b = parseFloat($('b').value);
    var f = parseFloat($('f').value) / 100;
    var n = parseInt($('n').value, 10);
    if (!(p > 0 && p < 1) || !(b > 0) || !(f >= 0 && f < 1) || !(n >= 1)) {
      alert('入力を確認してください（p は0〜100の間、b は0より大きい値、f は0以上100未満、n は1以上）。');
      return;
    }
    var q = 1 - p;
    var edge = b * p - q;              // 1を賭けたときの期待収支
    var fstar = edge / b;              // ケリー比率
    var gstar = fstar > 0 ? g(fstar, p, b) : 0;
    var gf = g(f, p, b);
    var fz = zeroPoint(p, b, fstar);
    var mult = Math.exp(n * gf);

    $('o-edge').textContent = (edge >= 0 ? '+' : '') + edge.toFixed(4) + '（賭け金1あたり）';
    $('o-fstar').textContent = fstar > 0 ? pct(fstar) + '（資金の割合）' : '0%（賭けないのが最適）';
    $('o-gstar').textContent = fstar > 0 ? gstar.toFixed(5) + ' /回' : '0.00000 /回';
    $('o-gf').textContent = gf.toFixed(5) + ' /回';
    $('o-fzero').textContent = fz ? pct(fz) : '該当なし（この条件では正の成長域がありません）';
    $('o-mult').textContent = fmtMult(mult) + '（' + n + '回後）';

    var w = fz ? Math.max(0, Math.min(100, (f / fz) * 100)) : (f > 0 ? 100 : 0);
    $('bar1').style.width = w.toFixed(1) + '%';

    var note;
    if (edge <= 0) {
      note = '⚠️ エッジが0以下です。この賭けはケリー基準の対象外で、最適な賭け金は0（張らない）です。' +
             'どんな賭け方をしても、賭けた総額に控除率を掛けた分だけ期待損失が積み上がります。';
    } else if (gf <= 0) {
      note = '⚠️ 期待値はプラスですが、張りすぎです。この f では成長率が0以下＝長期では資金が増えません。' +
             '成長率がゼロになる比率は ' + (fz ? pct(fz) : '—') + ' です。';
    } else if (f > fstar) {
      note = '成長率はプラスですが、ケリー比率 ' + pct(fstar) + ' を超えています。' +
             '増える速さは f* のときより遅く、途中の落ち込みは大きくなります。';
    } else if (f < fstar / 2) {
      note = 'ケリー比率の半分より小さい張り方です。増える速さは遅くなりますが、揺れは小さく抑えられます。';
    } else {
      note = 'ケリー比率（' + pct(fstar) + '）以下で、ハーフケリー以上の張り方です。速さと揺れのバランスが取れた領域です。';
    }
    if (fstar > 0) {
      var half = g(fstar / 2, p, b);
      note += ' 参考：f* の半分にすると成長率は最大値の ' +
              (gstar > 0 ? (half / gstar * 100).toFixed(0) : '—') + '% になります。';
    }
    $('o-note').textContent = note;
    $('out').hidden = false;
    if (typeof gtag === 'function') {
      gtag('event', 'kelly_calc', { p: p, b: b, f: f, n: n });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('run').addEventListener('click', run);
    ['p', 'b', 'f', 'n'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    });
    run();
  });
})();
