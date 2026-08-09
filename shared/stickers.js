/* 貼紙收集簿：答對、破關可以得到動物貼紙和獎盃，存在瀏覽器裡（localStorage） */

/* 最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對「最
   外層 let/const」有相容性 bug（函式讀不到），var 沒有這個問題。
   函式內部的 let/const 不受影響，不用改。 */
var STICKER_KEY = "stickerBook";

// 可以收集的貼紙（想加新的？直接加在這裡！）
var STICKER_POOL = [
  "🦁", "🐯", "🐼", "🐨", "🦊", "🦄", "🐬", "🦖",
  "🦉", "🐢", "🦋", "🐙", "🦩", "🐧", "🦒", "🐘",
];

// 獎盃清單：id → 名字（遊戲破紀錄時頒發）
var TROPHIES = {
  "balloons-count":         "🏆 數一數高手",
  "balloons-add":           "🏆 加法高手",
  "balloons-addsub":        "🏆 加減大師",
  "robot-all":              "🏆 程式小大師",
  "zhuyin-full":            "🏆 注音小達人",
  "abc-full":               "🏆 ABC 小達人",
  "zhuyin-speak-full":      "🏆 拼讀小達人",
  "zhuyin-speak-sentence-full": "🏆 短句朗讀高手",
};

function loadStickerBook() {
  try {
    return JSON.parse(localStorage.getItem(STICKER_KEY)) || { stickers: {}, trophies: {} };
  } catch (e) {
    return { stickers: {}, trophies: {} };
  }
}

function saveStickerBook(book) {
  localStorage.setItem(STICKER_KEY, JSON.stringify(book));
}

// 隨機得到一張貼紙，回傳貼紙 emoji（慶祝畫面會用到）
function awardSticker() {
  const book = loadStickerBook();
  const sticker = STICKER_POOL[Math.floor(Math.random() * STICKER_POOL.length)];
  book.stickers[sticker] = (book.stickers[sticker] || 0) + 1;
  saveStickerBook(book);
  return sticker;
}

// 頒發獎盃（同一個獎盃只會有一座）；第一次拿到回傳獎盃名字，拿過了回傳 null
function awardTrophy(id) {
  const book = loadStickerBook();
  if (book.trophies[id]) return null;
  book.trophies[id] = true;
  saveStickerBook(book);
  return TROPHIES[id] || null;
}

function getCollection() {
  return loadStickerBook();
}
