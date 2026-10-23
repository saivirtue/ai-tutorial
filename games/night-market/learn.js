/* 夜市的「學英文模式」
   ────────────────────────────────────────────────
   為什麼要做：以前是「先去答題賺貼紙，才能來夜市玩」，學習只是收費站。
   現在四攤本身就用英文玩——要聽懂、要認得，才打得到、射得到、撈得到。
   開關在攤位上方，可以關掉回到原本純玩的夜市。

   四攤的英文版：
     打地鼠　聽到 "B"，只打小寫 b 的地鼠（b 和 d 會刻意混在一起）
     射氣球　氣球上是單字，聽到 "dog" 就射 dog；射錯的不會破
     撈金魚　魚身上有字母，照順序撈出來拼成單字
     套圈圈　三個圖片，聽到 "dog" 時機要對、還要對準狗

   用到的字全部來自 shared/english-exam.js（學校的單字表），而且
   出題偏向還不熟的（shared/progress.js），答對答錯都會記進精熟度。

   這個檔案接在 index.html 主程式後面載入，直接用裡面的全域變數
   （playing、finish、aim、holesEl、fieldEl……）。

   最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對
   「最外層 let/const」有相容性 bug（函式讀不到）。 */

var LEARN_KEY = "nightMarketLearn";

var LEARN_MOLE_SECONDS = 20;    // 打地鼠限時
var LEARN_MOLE_TARGET = 6;      // 打對幾次算贏
var LEARN_MOLE_STAY_MS = 900;   // 地鼠停留多久（要看字母，比原本久一點）

var LEARN_BALLOON_SECONDS = 30; // 射氣球限時
var LEARN_BALLOON_TARGET = 5;   // 射對幾顆算贏

var LEARN_FISH_SECONDS = 45;    // 撈金魚限時
var LEARN_FISH_TARGET = 2;      // 拼出幾個單字算贏
var LEARN_FISH_MAX_LETTERS = 4; // 拼的單字最多幾個字母（太長 45 秒撈不完）

var learnMode = (function () {
  try { return localStorage.getItem(LEARN_KEY) !== "off"; } catch (e) { return true; }
})();

var hudEl = document.getElementById("hud");
var learnToggleEl = document.getElementById("learn-toggle");
var learnRecent = [];   // 最近出過的題目編號，不要連續出同一個

/* ===== 開關與攤位說明 ===== */

var NORMAL_DESC = {};
["mole", "balloon", "fish", "ring"].forEach(function (name) {
  NORMAL_DESC[name] = document.getElementById("desc-" + name).textContent;
});

var LEARN_DESC = {
  mole:    "聽[ㄊㄧㄥ]一[ㄧ]聽[ㄊㄧㄥ]，打[ㄉㄚˇ]對[ㄉㄨㄟˋ]的[˙ㄉㄜ]字[ㄗˋ]母[ㄇㄨˇ]",
  balloon: "聽[ㄊㄧㄥ]一[ㄧ]聽[ㄊㄧㄥ]，射[ㄕㄜˋ]對[ㄉㄨㄟˋ]的[˙ㄉㄜ]單[ㄉㄢ]字[ㄗˋ]",
  fish:    "撈[ㄌㄠ]字[ㄗˋ]母[ㄇㄨˇ]，拼[ㄆㄧㄣ]出[ㄔㄨ]單[ㄉㄢ]字[ㄗˋ]",
  ring:    "套[ㄊㄠˋ]中[ㄓㄨㄥˋ]對[ㄉㄨㄟˋ]的[˙ㄉㄜ]圖[ㄊㄨˊ]",
};

function refreshLearnUi() {
  setZy(learnToggleEl, learnMode ? "📖 學[ㄒㄩㄝˊ]英[ㄧㄥ]文[ㄨㄣˊ]：開[ㄎㄞ]" : "🎪 純[ㄔㄨㄣˊ]玩[ㄨㄢˊ]：學[ㄒㄩㄝˊ]英[ㄧㄥ]文[ㄨㄣˊ]關[ㄍㄨㄢ]");
  learnToggleEl.className = "big-btn zy " + (learnMode ? "blue" : "gray");
  Object.keys(NORMAL_DESC).forEach(function (name) {
    var el = document.getElementById("desc-" + name);
    if (learnMode) setZy(el, LEARN_DESC[name]);
    else { el.classList.remove("zy"); el.textContent = NORMAL_DESC[name]; }
  });
}

function toggleLearn() {
  if (playing) return;
  learnMode = !learnMode;
  try { localStorage.setItem(LEARN_KEY, learnMode ? "on" : "off"); } catch (e) {}
  playSound("click");
  refreshLearnUi();
}

// 回到攤位選單時收拾學英文模式留下的東西
function learnCleanup() {
  hudEl.hidden = true;
  hudEl.innerHTML = "";
  var zones = document.querySelectorAll(".ring-zone");
  for (var i = 0; i < zones.length; i++) zones[i].remove();
  targetEl.style.display = "";
}

/* ===== 小工具 ===== */

function learnPick(items, idOf) {
  var item = pickWeighted(items, idOf, learnRecent);
  learnRecent.push(idOf(item));
  if (learnRecent.length > 3) learnRecent.shift();
  return item;
}

// HUD：現在要找什麼。點一下可以再聽一次。
function showHud(html, answer, sayAgain) {
  hudEl.hidden = false;
  hudEl.innerHTML = html;
  hudEl.dataset.answer = answer;   // 測試用：現在要找的答案
  hudEl.onclick = sayAgain;
}

// 答錯記一次、答對（沒錯過）記一次；同一個題目只記一次，亂打不會把精熟度洗掉
function makeJudge(id) {
  var missed = false;
  return {
    wrong: function () {
      if (!missed) recordAnswer(id, false);
      missed = true;
    },
    right: function () {
      if (!missed) recordAnswer(id, true);
    },
  };
}

function learnStart(which) {
  if (which === "mole") learnMole();
  else if (which === "balloon") learnBalloons();
  else if (which === "fish") learnFish();
  else learnRing();
}

/* ===== 打地鼠：聽字母，打對的小寫 ===== */

function learnMole() {
  holesEl.hidden = false;
  holesEl.innerHTML = "";
  for (var i = 0; i < 9; i++) {
    var hole = document.createElement("div");
    hole.className = "hole";
    hole.innerHTML = '<span class="mole letter abc"></span>';
    hole.onclick = function (event) { if (window.whackHole) whackHole(event.currentTarget); };
    holesEl.appendChild(hole);
  }

  var hits = 0;
  var left = LEARN_MOLE_SECONDS;
  var target = null;
  var judge = null;

  function status() {
    statusEl.textContent = `打對 ${hits} 個，還有 ${left} 秒！`;
  }

  function newTarget() {
    target = learnPick(EXAM_LETTERS, letterId);
    judge = makeJudge(letterId(target));
    showHud(target.upper + ' <span class="small">🔊</span>', target.lower, function () { sayLetter(target); });
    sayLetter(target);
  }

  window.whackHole = function (hole) {
    if (!playing) return;

    // 沒有地鼠的洞：揮空了，要有反應
    if (!hole || !hole.classList.contains("up")) {
      playSound("wrong");
      if (hole) {
        hole.classList.add("shake");
        setTimeout(function () { hole.classList.remove("shake"); }, 300);
      }
      return;
    }

    if (hole.dataset.letter === target.lower) {
      hole.classList.remove("up");
      hole.classList.add("hit");
      setTimeout(function () { hole.classList.remove("hit"); }, 150);
      judge.right();
      hits++;
      playSound("pop");
      status();
      newTarget();
    } else {
      // 打到別的字母：不算分，地鼠留著（所以亂打不會比較快）
      judge.wrong();
      playSound("wrong");
      hole.classList.add("shake");
      setTimeout(function () { hole.classList.remove("shake"); }, 300);
    }
  };

  // 冒出來的字母：一半是要找的，其餘是別的；長得像的（b／d）特別常出現
  function letterForMole() {
    if (Math.random() < 0.45) return target.lower;
    var twin = CONFUSABLE[target.lower];
    if (twin && Math.random() < 0.4) return twin;
    var pool = EXAM_LETTERS.filter(function (l) { return l.lower !== target.lower; });
    return randomFrom(pool).lower;
  }

  newTarget();
  status();

  moleTick = setInterval(function () {
    var holes = holesEl.children;
    var pick = holes[Math.floor(Math.random() * holes.length)];
    if (pick.classList.contains("up")) return;
    var letter = letterForMole();
    pick.dataset.letter = letter;
    pick.querySelector(".mole").textContent = letter;
    pick.classList.add("up");
    setTimeout(function () { pick.classList.remove("up"); }, LEARN_MOLE_STAY_MS);
  }, 500);

  countdownTimer = setInterval(function () {
    left--;
    status();
    if (left <= 0) {
      stopMole();
      finish(hits >= LEARN_MOLE_TARGET, `你打對 ${hits} 個`);
    }
  }, 1000);
}

/* ===== 射氣球：聽單字，射寫著它的氣球 ===== */

function learnBalloons() {
  fieldEl.hidden = false;
  fieldEl.innerHTML = "";

  var popped = 0;
  var left = LEARN_BALLOON_SECONDS;
  var balloons = [];
  var target = null;
  var judge = null;

  function status() {
    statusEl.textContent = `射對 ${popped} 顆，還有 ${left} 秒！`;
  }

  function spawn(item) {
    var el = document.createElement("div");
    el.className = "target bubble abc c" + Math.floor(Math.random() * 5);
    el.textContent = item.word;
    fieldEl.appendChild(el);
    var balloon = {
      el: el,
      word: item.word,
      x: 12 + Math.random() * 76,
      y: 108,
      speed: 0.22 + Math.random() * 0.3,
    };
    balloons.push(balloon);
    el.onclick = function () { if (window.popBalloon) popBalloon(balloon); };
  }

  function alive() {
    return balloons.filter(function (b) { return !b.dead; });
  }

  // 場上一定要有「現在要找的」那顆，不然小孩怎麼找都找不到
  function ensureTarget() {
    var has = alive().some(function (b) { return b.word === target.word; });
    if (!has) spawn(target);
  }

  function newTarget() {
    target = learnPick(EXAM_LETTERS, wordId);
    judge = makeJudge(wordId(target));
    showHud(target.word + ' <span class="small">🔊</span>', target.word, function () { sayWord(target); });
    sayWord(target);
    ensureTarget();
  }

  window.popBalloon = function (balloon) {
    if (!playing || !balloon || balloon.dead) return;
    if (balloon.word === target.word) {
      balloon.dead = true;
      balloon.el.classList.add("popping");
      setTimeout(function () { balloon.el.remove(); }, 300);
      judge.right();
      popped++;
      playSound("pop");
      status();
      newTarget();
    } else {
      // 射到別的字：不會破，也不算分
      judge.wrong();
      playSound("wrong");
      balloon.el.classList.add("shake");
      setTimeout(function () { balloon.el.classList.remove("shake"); }, 400);
    }
  };

  window.balloonNear = function (xPercent, yPercent) {
    var best = null;
    var bestDist = BALLOON_HIT_RADIUS;
    balloons.forEach(function (b) {
      if (b.dead) return;
      var dist = Math.sqrt(Math.pow(b.x - xPercent, 2) + Math.pow(b.y - yPercent, 2));
      if (dist <= bestDist) { best = b; bestDist = dist; }
    });
    return best;
  };

  newTarget();
  for (var i = 0; i < 2; i++) spawn(randomFrom(EXAM_LETTERS.filter(function (l) { return l.word !== target.word; })));
  status();

  function frame() {
    balloons.forEach(function (b) {
      if (b.dead) return;
      b.y -= b.speed;
      if (b.y < -10) b.y = 108;
      b.el.style.left = b.x + "%";
      b.el.style.top = b.y + "%";
    });
    fieldAnim = requestAnimationFrame(frame);
  }
  frame();

  fieldTimer = setInterval(function () {
    if (alive().length < 6) {
      spawn(Math.random() < 0.4 ? target : randomFrom(EXAM_LETTERS));
    }
    ensureTarget();
  }, 1200);

  countdownTimer = setInterval(function () {
    left--;
    status();
    if (left <= 0) {
      stopField();
      finish(popped >= LEARN_BALLOON_TARGET, `你射對 ${popped} 顆`);
    }
  }, 1000);
}

/* ===== 撈金魚：魚身上有字母，撈出來拼單字 ===== */

function learnFish() {
  fieldEl.hidden = false;
  fieldEl.innerHTML = "";

  var caught = 0;
  var left = LEARN_FISH_SECONDS;
  var fishes = [];
  var holdOn = null;
  var holdMs = 0;
  var lastFrame = 0;

  var shortWords = EXAM_LETTERS.filter(function (l) { return l.word.length <= LEARN_FISH_MAX_LETTERS; });
  var target = null;
  var filled = 0;
  var judge = null;

  function status() {
    statusEl.textContent = `拼好 ${caught} 個，還有 ${left} 秒！`;
  }

  function drawHud() {
    var letters = target.word.split("").map(function (ch, i) {
      return i < filled ? ch : "_";
    }).join(" ");
    showHud(target.emoji + " " + letters + ' <span class="small">🔊</span>', target.word, function () { sayWord(target); });
  }

  function spawn(letter) {
    var el = document.createElement("div");
    el.className = "target fish-letter abc";
    el.innerHTML = "🐟<b>" + letter + "</b>";
    fieldEl.appendChild(el);
    fishes.push({
      el: el,
      letter: letter,
      x: 10 + Math.random() * 80,
      y: 15 + Math.random() * 70,
      vx: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.2),
      vy: (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.12),
    });
  }

  function alive() {
    return fishes.filter(function (f) { return !f.dead; });
  }

  // 池子裡一定要有「下一個要撈的字母」；其他是這個字的別的字母和干擾字母
  function ensureNeed() {
    var need = target.word.charAt(filled);
    if (!alive().some(function (f) { return f.letter === need; })) spawn(need);
    while (alive().length < 5) {
      var pool = target.word.split("").concat(EXAM_LETTERS.map(function (l) { return l.lower; }));
      spawn(randomFrom(pool));
    }
  }

  function newWord() {
    target = learnPick(shortWords, wordId);
    judge = makeJudge(wordId(target));
    filled = 0;
    drawHud();
    sayWord(target);
    ensureNeed();
  }

  function fishNear(xPercent, yPercent) {
    var best = null;
    var bestDist = FISH_HIT_RADIUS;
    alive().forEach(function (f) {
      var dist = Math.sqrt(Math.pow(f.x - xPercent, 2) + Math.pow(f.y - yPercent, 2));
      if (dist <= bestDist) { best = f; bestDist = dist; }
    });
    return best;
  }

  function scoop(fish) {
    if (!playing || fish.dead) return;
    holdOn = null;
    holdMs = 0;
    fish.el.classList.remove("scooping");

    if (fish.letter === target.word.charAt(filled)) {
      fish.dead = true;
      fish.el.classList.add("popping");
      setTimeout(function () { fish.el.remove(); }, 300);
      playSound("pop");
      filled++;
      if (filled === target.word.length) {
        judge.right();
        caught++;
        status();
        sayWord(target);
        if (caught < LEARN_FISH_TARGET) setTimeout(newWord, 900);
        else drawHud();
      } else {
        drawHud();
        ensureNeed();
      }
    } else {
      // 撈到別的字母：魚溜走了（游到別的地方），不算分
      judge.wrong();
      playSound("wrong");
      fish.el.classList.add("shake");
      setTimeout(function () { fish.el.classList.remove("shake"); }, 400);
      fish.x = 10 + Math.random() * 80;
      fish.y = 15 + Math.random() * 70;
    }
  }

  newWord();
  status();

  function frame(now) {
    var dt = lastFrame ? now - lastFrame : 16;
    lastFrame = now;

    fishes.forEach(function (f) {
      if (f.dead) return;
      f.x += f.vx;
      f.y += f.vy;
      if (f.x < 6 || f.x > 94) f.vx *= -1;
      if (f.y < 10 || f.y > 90) f.vy *= -1;
      f.el.style.left = f.x + "%";
      f.el.style.top = f.y + "%";
    });

    // 網子（＝瞄準點）罩著哪一條魚？罩夠久就撈起來
    var near = aim.active ? fishNear(aim.x, aim.y) : null;
    if (near && near === holdOn) {
      holdMs += dt;
      near.el.style.setProperty("--scoop", Math.min(1, holdMs / FISH_SCOOP_MS));
      if (holdMs >= FISH_SCOOP_MS) scoop(near);
    } else {
      if (holdOn) holdOn.el.classList.remove("scooping");
      holdOn = near;
      holdMs = 0;
      if (near) {
        near.el.classList.add("scooping");
        near.el.style.setProperty("--scoop", 0);
      }
    }

    fieldAnim = requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  countdownTimer = setInterval(function () {
    left--;
    status();
    // 拼夠了單字就提早結束，不用等倒數
    if (caught >= LEARN_FISH_TARGET || left <= 0) {
      stopField();
      finish(caught >= LEARN_FISH_TARGET, `你拼好 ${caught} 個單字`);
    }
  }, 1000);
}

/* ===== 套圈圈：聽單字，時機對、還要對準那個圖 ===== */

function learnRing() {
  ringAreaEl.hidden = false;
  throwBtn.disabled = false;

  // 原本的「命中區」換成三個圖片區
  targetEl.style.display = "none";
  var trackEl = document.getElementById("ring-track");
  var ZONES = [{ left: 4 }, { left: 38 }, { left: 72 }];
  var ZONE_WIDTH = 24;
  var zoneEls = ZONES.map(function (z) {
    var el = document.createElement("div");
    el.className = "ring-zone";
    el.style.left = z.left + "%";
    trackEl.insertBefore(el, markerEl);
    return el;
  });

  var throwsLeft = RING_THROWS;
  var hits = 0;
  var pos = 0;
  var dir = 1;
  var speed = 1.6;
  var target = null;
  var targetZone = 0;
  var judge = null;

  function newCall() {
    target = learnPick(EXAM_LETTERS, wordId);
    judge = makeJudge(wordId(target));
    var wrongs = shuffle(EXAM_LETTERS.filter(function (l) { return l !== target; })).slice(0, 2);
    var items = shuffle([target].concat(wrongs));
    targetZone = items.indexOf(target);
    zoneEls.forEach(function (el, i) { el.textContent = items[i].emoji; });
    showHud("🔊 " + target.word, ZONES[targetZone].left + "," + (ZONES[targetZone].left + ZONE_WIDTH), function () { sayWord(target); });
    sayWord(target);
  }

  function step() {
    pos += dir * speed;
    if (pos >= 100) { pos = 100; dir = -1; }
    if (pos <= 0) { pos = 0; dir = 1; }
    markerEl.style.left = `calc(${pos}% - 5px)`;
    ringAnim = requestAnimationFrame(step);
  }
  step();

  newCall();
  statusEl.textContent = `還有 ${throwsLeft} 個圈圈，套中 ${RING_TARGET} 次就贏！`;

  window.throwRing = function () {
    if (!playing || throwsLeft <= 0) return;

    var lo = ZONES[targetZone].left;
    var hit = pos >= lo && pos <= lo + ZONE_WIDTH;

    throwsLeft--;
    if (hit) {
      judge.right();
      hits++;
      playSound("pop");
      bottlesEl.textContent = "⭕".repeat(hits) + "🍾".repeat(Math.max(0, 3 - hits));
    } else {
      judge.wrong();
      playSound("wrong");
    }

    if (throwsLeft > 0) {
      newCall();
      statusEl.textContent = hit
        ? `套中了！還有 ${throwsLeft} 個圈圈`
        : `差一點！還有 ${throwsLeft} 個圈圈`;
    } else {
      stopRing();
      finish(hits >= RING_TARGET, `你套中 ${hits} 個`);
    }
  };
}

refreshLearnUi();
refreshProgress();   // 跟伺服器對一下進度，出題才知道哪些還不熟
