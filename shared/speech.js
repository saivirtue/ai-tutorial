/* 共用語音模組：用瀏覽器內建的中文語音唸題目和鼓勵話
   裝置沒有中文語音、或被 🔇 靜音時，全部靜默跳過——遊戲照常能玩。 */

/* 這個檔案最外層的變數全部用 var，不要用 let/const——某些電視盒的
   WebView 對「最外層 let/const」有相容性 bug（函式讀不到），var 沒
   有這個問題。函式內部的 let/const 不受影響，不用改。 */
var SPEECH_KEY = "speech-enabled";   // 記住 🔊/🔇 的選擇

var speechEnabled = localStorage.getItem(SPEECH_KEY) !== "off";
var chineseVoice = null;
var englishVoice = null;

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

var NORMAL_RATE = 0.9;   // 平常說話的速度（稍微慢一點，小孩聽得清楚）
var SLOW_RATE = 0.6;     // 「跟我唸」示範用的慢速

// 唸出一段話（會先打斷上一句，遊戲節奏才不會拖）
// onDone：唸完會呼叫（沒開聲音、或語音壞掉時也會呼叫，不會把流程卡死）
// rate：語速，不給就用 NORMAL_RATE
function speak(text, voice, lang, onDone, rate) {
  var speed = rate || NORMAL_RATE;
  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    if (onDone) onDone();
  }

  try {
    if (!speechEnabled || !window.speechSynthesis) {
      done();
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.lang = lang;
    utterance.rate = speed;
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);

    // 保險：有些瀏覽器的 onend 不一定會來，估一個時間硬叫一次，
    // 免得「等唸完再錄音」永遠等不到。唸得越慢就要等越久。
    setTimeout(done, (1200 + text.length * 180) * (NORMAL_RATE / speed));
  } catch (e) {
    done();   // 語音壞了也不能讓遊戲壞掉
  }
}

function say(text, onDone) {
  speak(text, chineseVoice, "zh-TW", onDone);
}

// 慢慢唸（跟讀小鸚鵡示範用：唸慢一點小孩才聽得出每個音）
function saySlow(text, onDone) {
  speak(text, chineseVoice, "zh-TW", onDone, SLOW_RATE);
}

// 唸英文（ABC 小火車用）
function sayEnglish(text, onDone) {
  speak(text, englishVoice, "en-US", onDone);
}

/* ===== 錄音檔覆蓋（跟讀小鸚鵡專用） =====
   語音合成再怎麼調還是有點機器人腔，最自然的辦法是家人自己錄音。
   把錄好的檔案放進 repo 根目錄的 audio/ 資料夾，檔名是「要唸的字」，
   例如 audio/你.mp3、audio/你好.mp3——不用改任何程式碼，遊戲會自動
   優先播放錄音檔，找不到才退回語音合成。 */

var clipCache = {};

// sayWithClip(要唸的字, 唸完要做什麼, 要不要慢慢唸)
// onDone 一定會被呼叫——就算靜音、沒有錄音檔、或播放失敗也一樣。
// 這很重要：跟讀小鸚鵡是「唸完就自動開始錄音」，onDone 沒來就會卡住。
function sayWithClip(text, onDone, slow) {
  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    if (onDone) onDone();
  }

  // 靜音時不出聲，但還是要回報「唸完了」，不然流程會停在這裡
  if (!speechEnabled) {
    done();
    return;
  }

  try {
    if (!(text in clipCache)) {
      clipCache[text] = new Audio(`/audio/${encodeURIComponent(text)}.mp3`);
    }
    const clip = clipCache[text];
    clip.playbackRate = slow ? SLOW_RATE : 1;
    clip.onended = done;
    clip.currentTime = 0;
    // 沒有錄音檔（404）或播放失敗，就改用語音合成
    clip.play().catch(() => (slow ? saySlow(text, done) : say(text, done)));
  } catch (e) {
    if (slow) saySlow(text, done);
    else say(text, done);
  }
}

/* ===== 鼓勵語 ===== */

/* 鼓勵語刻意都很短（一到三個字）——講太長會拖慢節奏，而且下一題的
   題目會把它打斷，聽起來反而更亂。想聽長一點的就自己加長。 */
var CHEERS = ["讚！", "答對了！", "好棒！", "太厲害！", "對！"];
var ENCOURAGES = ["再試一次！", "再想想！", "差一點點！", "加油！"];

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
