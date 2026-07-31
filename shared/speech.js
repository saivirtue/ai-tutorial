/* 共用語音模組：用瀏覽器內建的中文語音唸題目和鼓勵話
   裝置沒有中文語音、或被 🔇 靜音時，全部靜默跳過——遊戲照常能玩。 */

const SPEECH_KEY = "speech-enabled";   // 記住 🔊/🔇 的選擇

let speechEnabled = localStorage.getItem(SPEECH_KEY) !== "off";
let chineseVoice = null;
let englishVoice = null;

// 挑中文語音（優先台灣 zh-TW）和英文語音（優先美式 en-US）。
// 同語系裡優先選「進階／加強」版語音——聽起來自然很多，沒那麼像機器人。
// macOS：系統設定 → 輔助使用 → 語音內容，可以下載「Mei-Jia（進階）」之類的語音。
function pickVoice() {
  if (!window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices();
  const isEnhanced = (v) => /enhanced|premium|進階|加強/i.test(v.name);

  const zhVoices = voices.filter((v) => v.lang === "zh-TW");
  chineseVoice =
    zhVoices.find(isEnhanced) ||
    zhVoices[0] ||
    voices.find((v) => v.lang.startsWith("zh")) ||
    null;

  const enVoices = voices.filter((v) => v.lang === "en-US");
  englishVoice =
    enVoices.find(isEnhanced) ||
    enVoices[0] ||
    voices.find((v) => v.lang.startsWith("en")) ||
    null;
}

if (window.speechSynthesis) {
  pickVoice();
  // 有些瀏覽器語音清單是之後才載入的
  speechSynthesis.onvoiceschanged = pickVoice;
}

// 唸出一段話（會先打斷上一句，遊戲節奏才不會拖）
function speak(text, voice, lang) {
  try {
    if (!speechEnabled || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.lang = lang;
    utterance.rate = 0.9;    // 稍微慢一點，小孩聽得清楚
    speechSynthesis.speak(utterance);
  } catch (e) {
    // 語音壞了也不能讓遊戲壞掉
  }
}

function say(text) {
  speak(text, chineseVoice, "zh-TW");
}

// 唸英文（ABC 小火車用）
function sayEnglish(text) {
  speak(text, englishVoice, "en-US");
}

/* ===== 錄音檔覆蓋（跟讀小鸚鵡專用） =====
   語音合成再怎麼調還是有點機器人腔，最自然的辦法是家人自己錄音。
   把錄好的檔案放進 repo 根目錄的 audio/ 資料夾，檔名是「要唸的字」，
   例如 audio/你.mp3、audio/你好.mp3——不用改任何程式碼，遊戲會自動
   優先播放錄音檔，找不到才退回語音合成。 */

const clipCache = {};

function sayWithClip(text) {
  if (!speechEnabled) return;
  if (!(text in clipCache)) {
    clipCache[text] = new Audio(`/audio/${encodeURIComponent(text)}.mp3`);
  }
  const clip = clipCache[text];
  clip.currentTime = 0;
  clip.play().catch(() => say(text));   // 沒有錄音檔（404）或播放失敗，就改用語音合成
}

/* ===== 鼓勵語 ===== */

const CHEERS = ["哇！你好棒！", "答對了！太厲害了！", "好聰明！", "太強了吧！", "答對囉！繼續加油！"];
const ENCOURAGES = ["再想想看喔！", "差一點點，再試一次！", "沒關係，再想一下！", "加油，你可以的！"];

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function cheer() {
  say(randomFrom(CHEERS));
}

function encourage() {
  say(randomFrom(ENCOURAGES));
}

/* ===== 🔊/🔇 切換鈕：放在遊戲頁右上角 ===== */

function createSpeechToggle() {
  const btn = document.createElement("button");
  btn.id = "speech-toggle";
  btn.style.cssText =
    "position:fixed;top:10px;right:10px;z-index:100;font-size:26px;" +
    "background:rgba(0,0,0,0.3);border:none;border-radius:50%;" +
    "width:52px;height:52px;cursor:pointer;";
  const refresh = () => (btn.textContent = speechEnabled ? "🔊" : "🔇");
  refresh();
  btn.onclick = () => {
    speechEnabled = !speechEnabled;
    localStorage.setItem(SPEECH_KEY, speechEnabled ? "on" : "off");
    if (!speechEnabled && window.speechSynthesis) speechSynthesis.cancel();
    if (speechEnabled) say("打開聲音囉！");
    refresh();
  };
  document.body.appendChild(btn);
}

/* 手機瀏覽器規定：要等使用者碰過畫面才能出聲。
   第一次碰畫面時「暖機」一次，之後的 say()／sayWithClip() 就都能出聲了。 */
document.addEventListener(
  "pointerdown",
  () => {
    try {
      if (window.speechSynthesis) speechSynthesis.resume();
      // 也順便「解鎖」一下 <audio> 播放權限，之後 sayWithClip() 用 setTimeout
      // 觸發（不是直接在點擊事件裡）也不會被瀏覽器的自動播放限制擋掉
      const unlock = new Audio();
      unlock.play().catch(() => {});
    } catch (e) {}
  },
  { once: true }
);
