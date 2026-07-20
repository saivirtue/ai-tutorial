/* 共用語音模組：用瀏覽器內建的中文語音唸題目和鼓勵話
   裝置沒有中文語音、或被 🔇 靜音時，全部靜默跳過——遊戲照常能玩。 */

const SPEECH_KEY = "speech-enabled";   // 記住 🔊/🔇 的選擇

let speechEnabled = localStorage.getItem(SPEECH_KEY) !== "off";
let chineseVoice = null;

// 挑一個中文語音：優先台灣（zh-TW），找不到就任何中文
function pickVoice() {
  if (!window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices();
  chineseVoice =
    voices.find((v) => v.lang === "zh-TW") ||
    voices.find((v) => v.lang.startsWith("zh")) ||
    null;
}

if (window.speechSynthesis) {
  pickVoice();
  // 有些瀏覽器語音清單是之後才載入的
  speechSynthesis.onvoiceschanged = pickVoice;
}

// 唸出一段話（會先打斷上一句，遊戲節奏才不會拖）
function say(text) {
  try {
    if (!speechEnabled || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (chineseVoice) utterance.voice = chineseVoice;
    utterance.lang = "zh-TW";
    utterance.rate = 0.9;    // 稍微慢一點，小孩聽得清楚
    speechSynthesis.speak(utterance);
  } catch (e) {
    // 語音壞了也不能讓遊戲壞掉
  }
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
   第一次碰畫面時「暖機」一次，之後的 say() 就都能出聲了。 */
document.addEventListener(
  "pointerdown",
  () => {
    try {
      if (window.speechSynthesis) speechSynthesis.resume();
    } catch (e) {}
  },
  { once: true }
);
