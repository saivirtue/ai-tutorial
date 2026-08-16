/* 貼紙收集簿 ＋ 夜市代幣經濟
   ────────────────────────────────────────────────
   整個循環是這樣：
     學習遊戲破關 → 賺到貼紙 🦁
     花貼紙 → 玩夜市小遊戲
     夜市贏了 → 得到獎品 🧸
     獎品集滿一輪 → 跟爸媽換 10 元！

   資料存哪裡：
   - 先存在瀏覽器（localStorage），改完馬上看得到。
   - 同時「送一筆變更」給筆電伺服器存檔——這樣換 Wi-Fi、換 IP、
     關掉電視盒瀏覽器，貼紙都不會不見（之前就是因為只存瀏覽器，
     網址一變就等於換了一個新世界，收集全部歸零）。
   - 送給伺服器的是「發生了什麼事」（例如：得到一張 🦁），不是整本
     收集簿，這樣兩邊同時在玩也不會互相覆蓋。

   最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對
   「最外層 let/const」有相容性 bug（函式讀不到）。 */

var STICKER_KEY = "stickerBook";

// 可以收集的貼紙（想加新的？直接加在這裡！）
var STICKER_POOL = [
  "🦁", "🐯", "🐼", "🐨", "🦊", "🦄", "🐬", "🦖",
  "🦉", "🐢", "🦋", "🐙", "🦩", "🐧", "🦒", "🐘",
];

// 夜市可以贏到的獎品（集滿一輪就能換 10 元）
var PRIZE_POOL = ["🧸", "🎈", "🍭", "🏀", "🎁", "🚙", "🪀", "🎠"];

// 獎盃清單：id → 名字（遊戲破紀錄時頒發）
var TROPHIES = {
  "balloons-count":             "🏆 數一數高手",
  "balloons-add":               "🏆 加法高手",
  "balloons-addsub":            "🏆 加減大師",
  "robot-all":                  "🏆 程式小大師",
  "zhuyin-full":                "🏆 注音小達人",
  "abc-full":                   "🏆 ABC 小達人",
  "zhuyin-speak-full":          "🏆 拼讀小達人",
  "zhuyin-speak-sentence-full": "🏆 短句朗讀高手",
  "night-market-first":         "🏆 夜市高手",
};

function emptyBook() {
  return { stickers: {}, trophies: {}, prizes: {}, redeemed: 0 };
}

// 舊版本存的資料可能沒有 prizes/redeemed，補上預設值免得讀到 undefined
function normalizeBook(raw) {
  var book = emptyBook();
  if (raw && typeof raw === "object") {
    book.stickers = raw.stickers || {};
    book.trophies = raw.trophies || {};
    book.prizes = raw.prizes || {};
    book.redeemed = raw.redeemed || 0;
  }
  return book;
}

var stickerBook = emptyBook();

function loadLocal() {
  try {
    stickerBook = normalizeBook(JSON.parse(localStorage.getItem(STICKER_KEY)));
  } catch (e) {
    stickerBook = emptyBook();
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STICKER_KEY, JSON.stringify(stickerBook));
  } catch (e) {
    // 存不進去（例如無痕模式）也不能讓遊戲壞掉
  }
}

loadLocal();

/* ===== 跟伺服器同步 ===== */

// 把一筆變更送給伺服器存檔；沒開伺服器就靜默略過（遊戲照常能玩）。
// 優先用 sendBeacon——得到貼紙常常緊接著就換頁（慶祝畫面按下去就跳走），
// 一般的 fetch 在換頁時會被瀏覽器取消，貼紙就存不進去了；sendBeacon
// 就是為了這種「頁面要離開了還是要把資料送出去」設計的。
function pushAction(action) {
  var body = JSON.stringify(action);

  try {
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/stickers/apply", blob)) return;
    }
  } catch (e) {}

  try {
    fetch("/stickers/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
    }).catch(function () {});
  } catch (e) {}
}

// 開頁面時跟伺服器要最新的收集簿；拿到就以伺服器為準（它才是不會掉的那份）
function refreshStickers(onReady) {
  try {
    fetch("/stickers")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data) {
          stickerBook = normalizeBook(data);
          saveLocal();
        }
        if (onReady) onReady();
      })
      .catch(function () { if (onReady) onReady(); });
  } catch (e) {
    if (onReady) onReady();
  }
}

/* ===== 貼紙（＝夜市代幣） ===== */

// 手上還有幾張貼紙可以花
function stickerCount() {
  var total = 0;
  for (var key in stickerBook.stickers) {
    total += stickerBook.stickers[key];
  }
  return total;
}

// 收集到幾「種」貼紙（貼紙牆用）
function stickerKindsOwned() {
  var kinds = 0;
  for (var i = 0; i < STICKER_POOL.length; i++) {
    if (stickerBook.stickers[STICKER_POOL[i]] > 0) kinds++;
  }
  return kinds;
}

// 隨機得到一張貼紙，回傳貼紙 emoji。
// 優先發「還沒收集過的」，全部種類都有了才開始重複——這樣就不會
// 一直抽到重複的、有幾種永遠抽不到。
function awardSticker() {
  var missing = STICKER_POOL.filter(function (emoji) {
    return !stickerBook.stickers[emoji];
  });
  var pool = missing.length > 0 ? missing : STICKER_POOL;
  var sticker = pool[Math.floor(Math.random() * pool.length)];

  stickerBook.stickers[sticker] = (stickerBook.stickers[sticker] || 0) + 1;
  saveLocal();
  pushAction({ type: "award", sticker: sticker });
  return sticker;
}

// 花掉 n 張貼紙（夜市玩一場）；貼紙不夠回傳 false
function spendStickers(n) {
  if (stickerCount() < n) return false;

  var left = n;
  // 從數量最多的先花，盡量把「只有一張」的種類留在牆上好看
  var owned = Object.keys(stickerBook.stickers).filter(function (emoji) {
    return stickerBook.stickers[emoji] > 0;
  });
  owned.sort(function (a, b) {
    return stickerBook.stickers[b] - stickerBook.stickers[a];
  });

  for (var i = 0; i < owned.length && left > 0; i++) {
    var take = Math.min(left, stickerBook.stickers[owned[i]]);
    stickerBook.stickers[owned[i]] -= take;
    left -= take;
  }

  saveLocal();
  pushAction({ type: "spend", count: n });
  return true;
}

/* ===== 獎品（夜市贏到的，集滿換錢） ===== */

function prizeKindsOwned() {
  var kinds = 0;
  for (var i = 0; i < PRIZE_POOL.length; i++) {
    if (stickerBook.prizes[PRIZE_POOL[i]] > 0) kinds++;
  }
  return kinds;
}

// 夜市贏了：得到一個獎品，一樣優先給還沒有的
function awardPrize() {
  var missing = PRIZE_POOL.filter(function (emoji) {
    return !stickerBook.prizes[emoji];
  });
  var pool = missing.length > 0 ? missing : PRIZE_POOL;
  var prize = pool[Math.floor(Math.random() * pool.length)];

  stickerBook.prizes[prize] = (stickerBook.prizes[prize] || 0) + 1;
  saveLocal();
  pushAction({ type: "prize", prize: prize });
  return prize;
}

// 獎品全部種類都拿到了嗎？（可以換 10 元了）
function canRedeem() {
  return prizeKindsOwned() >= PRIZE_POOL.length;
}

// 換 10 元：記錄兌換次數，獎品櫃清空重新開始收集
function redeem() {
  if (!canRedeem()) return false;
  stickerBook.prizes = {};
  stickerBook.redeemed = (stickerBook.redeemed || 0) + 1;
  saveLocal();
  pushAction({ type: "redeem" });
  return true;
}

/* ===== 獎盃 ===== */

// 頒發獎盃（同一個獎盃只會有一座）；第一次拿到回傳獎盃名字，拿過了回傳 null
function awardTrophy(id) {
  if (stickerBook.trophies[id]) return null;
  stickerBook.trophies[id] = true;
  saveLocal();
  pushAction({ type: "trophy", id: id });
  return TROPHIES[id] || null;
}

function getCollection() {
  return stickerBook;
}
