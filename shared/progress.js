/* 英文精熟度：記住小孩每個字母、單字、數字、句子練到什麼程度
   ────────────────────────────────────────────────
   用來做三件事：
   1. 出題偏向還不熟的（錯過的、還沒看過的），已經很熟的少出一點
   2. 單字樂園：蛋 → 幼 → 成長 → 星星，久沒練會打瞌睡
   3. 教 Pip 的「故意講錯」會挑小孩常錯的字

   用「盒子」（Leitner box）記熟悉度，0～4：
     0 還沒看過　1 剛學、常錯　2 有點熟　3 熟了　4 很熟
   第一次就答對：升一格；答錯：退一格（最低退到 1）。
   盒子越高，隔越久才需要再複習（BOX_DAYS）。

   資料存在瀏覽器；有開筆電伺服器時也會送一份過去存檔（跟貼紙一樣的
   道理：換 Wi-Fi、換 IP，進度才不會歸零）。
   每個項目有自己的編號：
     letter:a　word:ant　number:3　phrase:Hello!

   最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對
   「最外層 let/const」有相容性 bug（函式讀不到）。 */

var PROGRESS_KEY = "englishProgress";
var BOX_DAYS = [0, 0, 1, 3, 7];   // 各個盒子隔幾天要複習
var DAY_MS = 24 * 60 * 60 * 1000;

var progress = {};   // 編號 → { box, right, wrong, last }

function loadProgressLocal() {
  try {
    var raw = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    progress = raw && typeof raw === "object" ? raw : {};
  } catch (e) {
    progress = {};
  }
}

function saveProgressLocal() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {
    // 存不進去（例如無痕模式）也不能讓遊戲壞掉
  }
}

loadProgressLocal();

/* ===== 跟伺服器同步（沒開伺服器就靜默略過） ===== */

function pushProgress(id, entry) {
  var body = JSON.stringify({ id: id, entry: entry });
  try {
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/progress/apply", blob)) return;
    }
  } catch (e) {}
  try {
    fetch("/progress/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
    }).catch(function () {});
  } catch (e) {}
}

// 開頁面時跟伺服器對一下：每個項目「最後練習時間」比較新的那份為準
function refreshProgress(onReady) {
  try {
    fetch("/progress")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (remote) {
        if (remote && typeof remote === "object") {
          for (var id in remote) {
            var mine = progress[id];
            if (!mine || (remote[id].last || 0) > (mine.last || 0)) progress[id] = remote[id];
          }
          saveProgressLocal();
        }
        if (onReady) onReady();
      })
      .catch(function () { if (onReady) onReady(); });
  } catch (e) {
    if (onReady) onReady();
  }
}

/* ===== 項目編號 ===== */

function letterId(item) { return "letter:" + item.lower; }
function wordId(item) { return "word:" + item.word; }
function numberId(item) { return "number:" + item.digit; }
function phraseId(item) { return "phrase:" + item.en; }

/* ===== 記錄與查詢 ===== */

function getEntry(id) {
  return progress[id] || { box: 0, right: 0, wrong: 0, last: 0 };
}

// 記一次作答。firstTry：這題第一次按就按對了（亂按、試出來的不算）
function recordAnswer(id, firstTry) {
  var entry = getEntry(id);
  var copy = { box: entry.box, right: entry.right, wrong: entry.wrong, last: Date.now() };
  if (firstTry) {
    copy.right++;
    // 沒看過的字第一次就答對：他可能本來就會，直接到第 2 格；之後每次答對升一格
    copy.box = Math.min(4, copy.box === 0 ? 2 : copy.box + 1);
  } else {
    copy.wrong++;
    copy.box = Math.max(1, copy.box - 1);
  }
  progress[id] = copy;
  saveProgressLocal();
  pushProgress(id, copy);
  return copy;
}

// 只是「看過、聽過」（例如貼紙場景放了一個貼紙）：從沒看過升到第 1 格，其他不動
function recordSeen(id) {
  var entry = getEntry(id);
  if (entry.box > 0) return entry;
  var copy = { box: 1, right: entry.right, wrong: entry.wrong, last: Date.now() };
  progress[id] = copy;
  saveProgressLocal();
  pushProgress(id, copy);
  return copy;
}

function boxOf(id) { return getEntry(id).box; }

// 該複習了嗎？（還沒看過的不算「複習」，是「新的」）
function isDue(id) {
  var entry = getEntry(id);
  if (entry.box === 0) return false;
  return Date.now() - entry.last >= BOX_DAYS[entry.box] * DAY_MS;
}

// 單字樂園用的階段：0 蛋　1 剛孵化　2 長大　3 星星
function stageOf(id) {
  var box = boxOf(id);
  if (box === 0) return 0;
  if (box <= 2) return 1;
  if (box === 3) return 2;
  return 3;
}

// 打瞌睡：已經學過、而且該複習了（盒子 2 以上才算，剛學的還不用）
function isSleepy(id) {
  return boxOf(id) >= 2 && isDue(id);
}

// 小孩特別需要練的：錯過、而且還沒練到很熟
function isWeak(id) {
  var entry = getEntry(id);
  return entry.wrong > 0 && entry.box <= 2;
}

/* ===== 出題：偏向還不熟的 =====
   每個項目一個「權重」：越不熟越容易被抽到，該複習的再加成。
   avoid：最近剛出過的編號（不要連續出同一個）。 */
function weightOf(id) {
  var box = boxOf(id);
  var base = [3, 4, 3, 2, 1][box];
  return isDue(id) ? base * 1.5 : base;
}

function pickWeighted(items, idOf, avoid) {
  var pool = items.filter(function (item) { return !avoid || avoid.indexOf(idOf(item)) < 0; });
  if (pool.length === 0) pool = items;
  var total = 0;
  var weights = pool.map(function (item) {
    var w = weightOf(idOf(item));
    total += w;
    return w;
  });
  var roll = Math.random() * total;
  for (var i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
