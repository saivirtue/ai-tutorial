/* 手勢辨識邏輯，逐行對照 server/vision_server.py 的 GestureTracker／
   count_fingers／手掌大小計算 port 過來的——數字常數、演算法都跟伺服器
   端完全一樣（包括「短暫追蹤丟失不清歷史」那個修正），這樣行為才會
   跟已經在家裡驗證過的伺服器版一致，不是另一套邏輯重新猜一次。

   這是 POC：目的是驗證「手勢辨識整個搬到瀏覽器端跑」在技術上到底
   可不可行，不是要取代現在的伺服器架構。差異在於——
   伺服器版：Python + OpenCV/MediaPipe 在筆電上跑，結果用 WebSocket 廣播
   這個版本：手機/筆電瀏覽器自己用 MediaPipe Tasks Vision（WASM）跑，
             不需要另一台機器、不需要 WebSocket，純靜態網頁就能動

   ES module，用 <script type="module"> 引入。 */

export const GESTURE_CONSTANTS = {
  PUSH_GROWTH: 1.18,       // 手掌在 PUSH_WINDOW 內變大幾倍算「往前揮」
  PUSH_WINDOW: 0.35,       // 秒
  SWIPE_DISTANCE: 0.22,    // 手掌位置移動多少（畫面寬度的比例）算「揮」
  SWIPE_WINDOW: 0.40,      // 秒
  GESTURE_COOLDOWN: 0.45,  // 出了一個手勢之後，這段時間內不再出下一個
  LOST_GRACE: 0.2,         // 手不見超過這麼久才真的清掉手勢歷史
};

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export class GestureTracker {
  /**
   * @param {(name: string, extra: object) => void} onGesture 偵測到手勢時呼叫
   * @param {() => number} clock 回傳「現在」的秒數（測試時可以換成假時鐘）
   */
  constructor(onGesture, clock) {
    this.history = [];         // [{ t, x, y, scale }]
    this.lastFired = 0;
    this.handLostSince = null;
    this.onGesture = onGesture;
    this.now = clock || (() => performance.now() / 1000);
  }

  reset() {
    this.history = [];
  }

  /**
   * 呼叫端在「這一幀沒看到手」時呼叫。跟 Python 版一樣：短暫的追蹤
   * 丟失（例如揮拳揮到一半、動作模糊）不會馬上清歷史，只有真的消失
   * 超過 LOST_GRACE 才清——不然揮拳最快、最該被抓到的那一刻，資料反而
   * 會被自己洗掉。
   */
  markLost() {
    const now = this.now();
    if (this.handLostSince === null) {
      this.handLostSince = now;
    } else if (now - this.handLostSince >= GESTURE_CONSTANTS.LOST_GRACE) {
      this.reset();
    }
  }

  /** 這一幀看到手了，位置 (x,y) 是 0~1，scale 是手掌大小（同單位）。 */
  update(x, y, scale) {
    this.handLostSince = null;
    const now = this.now();
    this.history.push({ t: now, x, y, scale });

    const window = Math.max(GESTURE_CONSTANTS.PUSH_WINDOW, GESTURE_CONSTANTS.SWIPE_WINDOW);
    const cutoff = now - window;
    this.history = this.history.filter((entry) => entry.t >= cutoff);

    if (now - this.lastFired < GESTURE_CONSTANTS.GESTURE_COOLDOWN) return;

    // --- 往前揮：手掌變大 ---
    const oldPush = this._oldestWithin(now, GESTURE_CONSTANTS.PUSH_WINDOW);
    if (oldPush && oldPush.scale > 0 && scale / oldPush.scale >= GESTURE_CONSTANTS.PUSH_GROWTH) {
      this._fire(now, "push", { x: round3(x), y: round3(y) });
      return;
    }

    // --- 左右上下揮：手掌位置大幅移動 ---
    const oldSwipe = this._oldestWithin(now, GESTURE_CONSTANTS.SWIPE_WINDOW);
    if (!oldSwipe) return;
    const dx = x - oldSwipe.x;
    const dy = y - oldSwipe.y;
    if (Math.abs(dx) >= GESTURE_CONSTANTS.SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      this._fire(now, "swipe", { dir: dx > 0 ? "right" : "left" });
    } else if (Math.abs(dy) >= GESTURE_CONSTANTS.SWIPE_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
      this._fire(now, "swipe", { dir: dy > 0 ? "down" : "up" });
    }
  }

  _fire(now, name, extra) {
    this.lastFired = now;
    this.history = [];   // 出過手勢就重新開始算，不要一個動作連發好幾次
    this.onGesture(name, extra);
  }

  _oldestWithin(now, window) {
    for (const entry of this.history) {
      if (now - entry.t <= window) return entry;
    }
    return null;
  }
}

/* ===== 從 MediaPipe HandLandmarker 的結果算手指數／手掌大小／游標位置 =====
   landmarks 是一隻手的 21 個關鍵點（0~1 正規化座標），跟 Python 那邊
   legacy mediapipe.solutions.hands 給的點位編號完全一樣。 */

// 比了幾根手指。food/中指/無名指/小指：指尖比第二關節高就算伸出來；
// 拇指橫著長，用 x 判斷，且左右手方向相反。
export function countFingers(landmarks, handednessLabel) {
  let count = 0;
  for (const tip of [8, 12, 16, 20]) {
    if (landmarks[tip].y < landmarks[tip - 2].y) count++;
  }
  if (handednessLabel === "Right") {
    if (landmarks[4].x < landmarks[3].x) count++;
  } else {
    if (landmarks[4].x > landmarks[3].x) count++;
  }
  return count;
}

// 手腕(0)到中指根部(9)的距離代表手掌大小——手往鏡頭伸過來時會變大。
export function palmScale(landmarks) {
  const dx = landmarks[9].x - landmarks[0].x;
  const dy = landmarks[9].y - landmarks[0].y;
  return Math.hypot(dx, dy);
}

// 手在畫面上的游標位置。x 左右鏡射，這樣才像照鏡子：手往右移，
// 畫面上的游標也往右移。
export function cursorPosition(landmarks) {
  return { x: 1.0 - landmarks[9].x, y: landmarks[9].y };
}
