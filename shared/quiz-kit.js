/* 共用的小題目元件：選擇題、拼字
   ────────────────────────────────────────────────
   單字樂園、教 Pip 都要出「選一個」和「拼單字」，答錯怎麼處理要一
   致，所以放在這裡，不要每個遊戲各寫一份：
     答錯：選項變暗、抖一下，再唸一次給他聽
     連錯 QK_REVEAL_AFTER 次：正確答案一閃一閃，其他選項收起來——
       這時候該「教」他，不是讓他繼續猜
     第一次就按對才算「第一次就對」（亂按、試出來的不算）

   需要先載入：game-utils.js、speech.js、zhuyin.js
   （CSS 在 shared/style.css 的 .qk-* ）

   最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對
   「最外層 let/const」有相容性 bug（函式讀不到）。 */

var QK_REVEAL_AFTER = 2;   // 連錯幾次就亮出正確答案

/* 選擇題。
   host：放選項的元素
   q：{ options: [{ text, correct }], say(): 唸一次英文,
        letters: 選項用英文字體, textMode: 選項是長字句用小字 }
   onDone(firstTry)：選對之後（稍等一下）呼叫，firstTry 表示第一次就按對 */
function qkChoices(host, q, onDone) {
  host.innerHTML = "";
  host.className = "qk-choices" + (q.textMode ? " text" : "");
  var tries = 0;
  var locked = false;

  function reveal() {
    var right = host.querySelector('button[data-correct="1"]');
    if (right) right.classList.add("reveal");
    var wrongs = host.querySelectorAll('button[data-correct="0"]');
    for (var i = 0; i < wrongs.length; i++) wrongs[i].disabled = true;
    say("是這個喔！", function () { if (q.say) q.say(); });
  }

  shuffle(q.options).forEach(function (opt) {
    var btn = document.createElement("button");
    btn.className = "big-btn zy" + (q.letters ? " abc" : "");
    btn.innerHTML = zy(opt.text);
    btn.dataset.correct = opt.correct ? "1" : "0";   // 測試用
    btn.onclick = function () {
      if (locked) return;
      if (opt.correct) {
        locked = true;
        playSound("pop");
        cheer();
        btn.style.background = "var(--good)";
        btn.classList.remove("reveal");
        var firstTry = tries === 0;
        setTimeout(function () { onDone(firstTry); }, 800);
      } else {
        tries++;
        playSound("wrong");
        btn.disabled = true;
        btn.classList.add("shake");
        if (tries >= QK_REVEAL_AFTER) {
          reveal();
        } else {
          encourage();
          if (q.say) setTimeout(q.say, 900);
        }
      }
    };
    host.appendChild(btn);
  });
}

/* 拼字：上面一排空格，下面是打亂的字母，照順序點就會填進去。
   slotsHost、tilesHost：放空格、字母的元素
   word：要拼的單字　sayFn()：唸這個字
   onDone(firstTry)：拼完（稍等一下）呼叫 */
function qkSpell(slotsHost, tilesHost, word, sayFn, onDone) {
  slotsHost.innerHTML = "";
  tilesHost.innerHTML = "";
  slotsHost.className = "qk-slots";
  tilesHost.className = "qk-tiles";
  var filled = 0;
  var misses = 0;
  var anyMiss = false;
  var locked = false;

  word.split("").forEach(function () {
    var slot = document.createElement("div");
    slot.className = "qk-slot abc";
    slotsHost.appendChild(slot);
  });

  shuffle(word.split("")).forEach(function (letter) {
    var tile = document.createElement("button");
    tile.className = "big-btn qk-tile abc";
    tile.textContent = letter;
    tile.onclick = function () {
      if (locked || tile.classList.contains("used")) return;
      var need = word.charAt(filled);
      if (letter === need) {
        playSound("click");
        slotsHost.children[filled].textContent = letter;
        tile.classList.add("used");
        var glowing = tilesHost.querySelectorAll(".reveal");
        for (var i = 0; i < glowing.length; i++) glowing[i].classList.remove("reveal");
        filled++;
        misses = 0;
        if (filled === word.length) {
          locked = true;
          playSound("pop");
          cheer();
          if (sayFn) sayFn();
          var firstTry = !anyMiss;
          setTimeout(function () { onDone(firstTry); }, 1100);
        }
      } else {
        playSound("wrong");
        anyMiss = true;
        misses++;
        tile.classList.add("shake");
        setTimeout(function () { tile.classList.remove("shake"); }, 450);
        if (misses >= QK_REVEAL_AFTER) {
          // 連錯兩次：把該放的那個字母閃出來
          var left = tilesHost.querySelectorAll(".qk-tile:not(.used)");
          for (var j = 0; j < left.length; j++) {
            if (left[j].textContent === need) { left[j].classList.add("reveal"); break; }
          }
        }
      }
    };
    tilesHost.appendChild(tile);
  });
}
