/* 英語日小考的題庫：照學校發的「單字表」整理
   ────────────────────────────────────────────────
   學校教到哪、就把那一部分加在這裡——不用改遊戲程式。
   現在是第一次英語日測驗（Part 1～Part 4）的範圍，只到 Aa～Mm。
   之後教到 N～Z，就照樣子在 EXAM_LETTERS 後面加一行就好。

   中文用 shared/zhuyin.js 的寫法：國字後面用 [ ] 放注音，
   例如 "螞[ㄇㄚˇ]蟻[ㄧˇ]"。要拿掉注音只留國字，用 zyPlain()。

   最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對
   「最外層 let/const」有相容性 bug（函式讀不到）。 */

/* ===== Part 1 + Part 4：字母 ＋ 單字 =====
   upper：大寫　lower：小寫　word：單字表上的單字
   zh：中文（含注音）　emoji：題目用的圖
   home：住在單字樂園的哪裡——sky 天空／land 草地／water 水裡 */
var EXAM_LETTERS = [
  { upper: "A", lower: "a", word: "ant",    zh: "螞[ㄇㄚˇ]蟻[ㄧˇ]",          emoji: "🐜", home: "land" },
  { upper: "B", lower: "b", word: "bird",   zh: "鳥[ㄋㄧㄠˇ]",                emoji: "🐦", home: "sky" },
  { upper: "C", lower: "c", word: "cat",    zh: "貓[ㄇㄠ]",                  emoji: "🐱", home: "land" },
  { upper: "D", lower: "d", word: "dog",    zh: "狗[ㄍㄡˇ]",                 emoji: "🐶", home: "land" },
  { upper: "E", lower: "e", word: "egg",    zh: "蛋[ㄉㄢˋ]",                 emoji: "🥚", home: "land" },
  { upper: "F", lower: "f", word: "fish",   zh: "魚[ㄩˊ]",                  emoji: "🐟", home: "water" },
  { upper: "G", lower: "g", word: "girl",   zh: "女[ㄋㄩˇ]孩[ㄏㄞˊ]",         emoji: "👧", home: "land" },
  { upper: "H", lower: "h", word: "hat",    zh: "帽[ㄇㄠˋ]子[˙ㄗ]",          emoji: "🎩", home: "land" },
  { upper: "I", lower: "i", word: "insect", zh: "昆[ㄎㄨㄣ]蟲[ㄔㄨㄥˊ]",      emoji: "🐛", home: "land" },
  { upper: "J", lower: "j", word: "jet",    zh: "噴[ㄆㄣ]射[ㄕㄜˋ]機[ㄐㄧ]",  emoji: "🛩️", home: "sky" },
  { upper: "K", lower: "k", word: "kite",   zh: "風[ㄈㄥ]箏[ㄓㄥ]",          emoji: "🪁", home: "sky" },
  { upper: "L", lower: "l", word: "lion",   zh: "獅[ㄕ]子[˙ㄗ]",             emoji: "🦁", home: "land" },
  { upper: "M", lower: "m", word: "monkey", zh: "猴[ㄏㄡˊ]子[˙ㄗ]",          emoji: "🐵", home: "land" },
];

// 長得像、小孩容易搞混的字母（小寫）：出選項時會刻意放進去
var CONFUSABLE = { b: "d", d: "b", i: "j", j: "i", c: "e", e: "c", g: "j", h: "k", k: "h" };

/* ===== Part 2：數字 1～10 ===== */
var EXAM_NUMBERS = [
  { digit: "1", word: "one" },
  { digit: "2", word: "two" },
  { digit: "3", word: "three" },
  { digit: "4", word: "four" },
  { digit: "5", word: "five" },
  { digit: "6", word: "six" },
  { digit: "7", word: "seven" },
  { digit: "8", word: "eight" },
  { digit: "9", word: "nine" },
  { digit: "10", word: "ten" },
];

/* ===== Part 3：生活對話 ＋ 中文翻譯 =====
   clip：錄音檔檔名（audio/en/ 底下，不含 .mp3）
   Goodbye / Bye / See you 三句的中文都是「再見」，所以遊戲用中文
   一樣就算對（不會把它們放在同一題當錯誤選項）。 */
var EXAM_PHRASES = [
  { en: "Good morning.",     clip: "good-morning",   zh: "早[ㄗㄠˇ]安[ㄢ]。" },
  { en: "Hi!",               clip: "hi",             zh: "嗨[ㄏㄞ]！" },
  { en: "Hello!",            clip: "hello",          zh: "哈[ㄏㄚ]囉[ㄌㄨㄛ]！" },
  { en: "Line up, please.",  clip: "line-up-please", zh: "請[ㄑㄧㄥˇ]排[ㄆㄞˊ]隊[ㄉㄨㄟˋ]。" },
  { en: "Look!",             clip: "look",           zh: "看[ㄎㄢˋ]！" },
  { en: "Are you ready?",    clip: "are-you-ready",  zh: "準[ㄓㄨㄣˇ]備[ㄅㄟˋ]好[ㄏㄠˇ]了[˙ㄌㄜ]嗎[˙ㄇㄚ]？" },
  { en: "Yes.",              clip: "yes",            zh: "好[ㄏㄠˇ]了[˙ㄌㄜ]。" },
  { en: "Watch out!",        clip: "watch-out",      zh: "小[ㄒㄧㄠˇ]心[ㄒㄧㄣ]！" },
  { en: "Goodbye.",          clip: "goodbye",        zh: "再[ㄗㄞˋ]見[ㄐㄧㄢˋ]。" },
  { en: "Bye.",              clip: "bye",            zh: "再[ㄗㄞˋ]見[ㄐㄧㄢˋ]。" },
  { en: "See you.",          clip: "see-you",        zh: "再[ㄗㄞˋ]見[ㄐㄧㄢˋ]。" },
];

/* ===== 錄音檔檔名（audio/en/）：遊戲唸英文時會先找這些檔 ===== */
function letterClip(item) { return "letter-" + item.lower; }   // 字母名稱：letter-b.mp3
function wordClip(item) { return item.word; }                  // 單字：cat.mp3
function numberClip(item) { return item.word; }                // 數字：three.mp3

// 唸出來：第一個是要唸的字（沒錄音檔時給語音合成用），第二個是錄音檔檔名
function sayLetter(item, onDone) { sayEnglishClip(item.upper, onDone, letterClip(item)); }
function sayWord(item, onDone) { sayEnglishClip(item.word, onDone, wordClip(item)); }
function sayNumber(item, onDone) { sayEnglishClip(item.word, onDone, numberClip(item)); }
function sayPhrase(item, onDone) { sayEnglishClip(item.en, onDone, item.clip); }
