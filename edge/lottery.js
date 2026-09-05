/* 還元率ラボ 宝くじ面 — 1等を1回引くまでの期待支出
   現金は一切扱わない。表示される「円」はすべてシミュレーション上の数値。 */
(function () {
  'use strict';
  // combos は組合せの数（本ページ本文と同じ値・数え上げで確定）。
  // 1口の金額と年間抽せん回数は一次情報で確定できなかったため、値を持たせずユーザー入力にしている。
  var LOTS = [
    { id: 'loto7',  name: 'ロト7（37から7個）',   combos: 10295472 },
    { id: 'loto6',  name: 'ロト6（43から6個）',   combos: 6096454 },
    { id: 'mini',   name: 'ミニロト（31から5個）', combos: 169911 },
    { id: 'num4',   name: 'ナンバーズ4 ストレート', combos: 10000 },
    { id: 'num3',   name: 'ナンバーズ3 ストレート', combos: 1000 }
  ];
  var $ = function (id) { return document.getElementById(id); };
  var sel = $('lot'), out = $('out'), note = $('note');

  LOTS.forEach(function (l) {
    var o = document.createElement('option');
    o.value = l.id; o.textContent = l.name;
    sel.appendChild(o);
  });
  sel.value = 'loto6';

  function num(v) { return Math.round(v).toLocaleString('ja-JP'); }

  function render() {
    var l = LOTS.filter(function (x) { return x.id === sel.value; })[0];
    var k = Math.max(1, Number($('kuchi').value) || 1);
    var price = Math.max(1, Number($('price').value) || 200);
    var perYear = Math.max(1, Number($('peryear').value) || 104);
    var tries = l.combos / k;             // 1等を1回引くまでの抽せん回数（期待値）
    var years = tries / perYear;
    var spend = l.combos * price;         // 口数を増やしても期待支出は変わらない
    var yearsTxt = years >= 1 ? num(years) + '年' : Math.round(years * 12) + 'か月';

    out.innerHTML =
      '<div class="kv"><span>1等の確率（1口）</span><b>1 / ' + num(l.combos) + '</b></div>' +
      '<div class="kv"><span>1回の抽せんで買う口数</span><b>' + num(k) + '口（' + num(k * l.price) + '円）</b></div>' +
      '<div class="kv"><span>1等を1回引くまでの抽せん回数</span><b>' + num(tries) + '回</b></div>' +
      '<div class="kv"><span>同（年数に直すと）</span><b>' + yearsTxt + '</b></div>' +
      '<div class="kv"><span>そこまでに買う総額</span><b>' + num(spend) + '円</b></div>' +
      '<div class="kv"><span>買う口数を増やすと</span><b>年数は縮むが総額は変わらない</b></div>';
    out.hidden = false;
    note.hidden = false;

    if (typeof gtag === 'function') {
      gtag('event', 'sim_run', {
        area: 'edge', mode: 'lottery', game: l.id, trials: k, from_page: '/edge/takarakuji'
      });
    }
  }
  $('run').addEventListener('click', render);
})();
