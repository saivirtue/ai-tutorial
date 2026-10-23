/* 英語日小考的題庫：照學校發的「單字表」整理
   ────────────────────────────────────────────────
   學校教到哪、就把那一部分加在這裡——不用改遊戲程式。
   現在是第一次英語日測驗（Part 1～Part 4）的範圍，只到 Aa～Mm。
   之後教到 N～Z，就照樣子在 EXAM_LETTERS 後面加一行就好。

   最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對
   「最外層 let/const」有相容性 bug（函式讀不到）。 */

/* ===== Part 1 + Part 4：字母 ＋ 單字 =====
   upper：大寫　lower：小寫　word：單字表上的單字
   zh：中文　emoji：題目用的圖 */
var EXAM_LETTERS = [
  { upper: "A", lower: "a", word: "ant",    zh: "螞蟻",   emoji: "🐜" },
  { upper: "B", lower: "b", word: "bird",   zh: "鳥",     emoji: "🐦" },
  { upper: "C", lower: "c", word: "cat",    zh: "貓",     emoji: "🐱" },
  { upper: "D", lower: "d", word: "dog",    zh: "狗",     emoji: "🐶" },
  { upper: "E", lower: "e", word: "egg",    zh: "蛋",     emoji: "🥚" },
  { upper: "F", lower: "f", word: "fish",   zh: "魚",     emoji: "🐟" },
  { upper: "G", lower: "g", word: "girl",   zh: "女孩",   emoji: "👧" },
  { upper: "H", lower: "h", word: "hat",    zh: "帽子",   emoji: "🎩" },
  { upper: "I", lower: "i", word: "insect", zh: "昆蟲",   emoji: "🐛" },
  { upper: "J", lower: "j", word: "jet",    zh: "噴射機", emoji: "🛩️" },
  { upper: "K", lower: "k", word: "kite",   zh: "風箏",   emoji: "🪁" },
  { upper: "L", lower: "l", word: "lion",   zh: "獅子",   emoji: "🦁" },
  { upper: "M", lower: "m", word: "monkey", zh: "猴子",   emoji: "🐵" },
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
   Goodbye / Bye / See you 三句的中文都是「再見」，所以遊戲用中文
   一樣就算對（不會把它們放在同一題當錯誤選項）。 */
var EXAM_PHRASES = [
  { en: "Good morning.",     zh: "早安。" },
  { en: "Hi!",               zh: "嗨！" },
  { en: "Hello!",            zh: "哈囉！" },
  { en: "Line up, please.",  zh: "請排隊。" },
  { en: "Look!",             zh: "看！" },
  { en: "Are you ready?",    zh: "準備好了嗎？" },
  { en: "Yes.",              zh: "好了。" },
  { en: "Watch out!",        zh: "小心！" },
  { en: "Goodbye.",          zh: "再見。" },
  { en: "Bye.",              zh: "再見。" },
  { en: "See you.",          zh: "再見。" },
];
