/* 共用遊戲工具：音效、星星計分、慶祝動畫
   所有遊戲都會用到這個檔案，程式碼盡量簡單，方便和小孩一起讀。 */

/* ===== 音效（用 WebAudio 直接「畫」出聲音，不需要音檔） ===== */

/* 最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對「最
   外層 let/const」有相容性 bug（函式讀不到），var 沒有這個問題。
   函式內部的 let/const 不受影響，不用改。 */
var audioCtx = null;

function getAudioCtx() {
  // 瀏覽器規定：要等使用者點過畫面才能發出聲音，所以用到時才建立
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// 播放一個「嗶」：frequency 是音高（Hz）、duration 是長度（秒）
function beep(frequency, duration, delay = 0, type = "square") {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.2, ctx.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration);
}

// 遊戲裡會用到的幾種音效
var SOUNDS = {
  click: () => beep(600, 0.08),                       // 按按鈕
  pop:   () => { beep(500, 0.08); beep(900, 0.1, 0.06); },  // 答對／氣球爆
  wrong: () => beep(160, 0.3, 0, "sawtooth"),          // 答錯
  step:  () => beep(400, 0.06, 0, "triangle"),         // 機器人走一步
  crash: () => { beep(200, 0.15, 0, "sawtooth"); beep(120, 0.3, 0.1, "sawtooth"); }, // 撞牆
  win:   () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.18, i * 0.15)), // 勝利音階 Do Mi Sol Do
};

function playSound(name) {
  try {
    SOUNDS[name]();
  } catch (e) {
    // 聲音放不出來也不要讓遊戲壞掉
  }
}

/* ===== 星星計分列 ===== */

// 在 container 裡畫出 total 顆星星，回傳一個「更新函式」：setStars(3) 就會亮 3 顆
function createStarBar(container, total) {
  container.classList.add("star-bar");
  return function setStars(count) {
    container.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const star = document.createElement("span");
      star.textContent = "⭐";
      star.className = i < count ? "on" : "off";
      container.appendChild(star);
    }
  };
}

/* ===== 全螢幕慶祝（彩帶＋大字＋勝利音效） ===== */

var CONFETTI_COLORS = ["#ff5a5a", "#ffd93d", "#3ecf6b", "#4a7bff", "#ff8a3d", "#c77dff"];

function dropConfetti(count = 80) {
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDuration = 2 + Math.random() * 2 + "s";
    piece.style.animationDelay = Math.random() * 0.8 + "s";
    document.body.appendChild(piece);
    // 掉完就把彩帶收走，不要越積越多
    setTimeout(() => piece.remove(), 5000);
  }
}

// celebrate("太棒了！", 按鈕文字, 按下按鈕要做的事)
function celebrate(message, buttonText, onButton) {
  playSound("win");
  dropConfetti();

  const overlay = document.createElement("div");
  overlay.id = "celebrate-overlay";

  const msg = document.createElement("div");
  msg.className = "msg";
  msg.textContent = message;
  overlay.appendChild(msg);

  const btn = document.createElement("button");
  btn.className = "big-btn green";
  btn.textContent = buttonText;
  btn.onclick = () => {
    overlay.remove();
    if (onButton) onButton();
  };
  overlay.appendChild(btn);

  document.body.appendChild(overlay);
}

/* ===== 小工具 ===== */

// 從 1 到 max 隨機取一個整數
function randomInt(max) {
  return Math.floor(Math.random() * max) + 1;
}

// 把陣列洗牌（隨機打亂順序）
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
