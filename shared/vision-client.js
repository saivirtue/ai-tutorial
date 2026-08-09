/* 視覺輸入客戶端：連上筆電的鏡頭伺服器
   連不上（例如放在 GitHub Pages、或沒開伺服器）就靜默放棄，遊戲照常用觸控玩。

   同一個 WebSocket 也用來通知伺服器「里程碑達成」，讓伺服器觸發 SwitchBot
   按下實體按鈕——所以不管遊戲有沒有用到鏡頭，都可以呼叫 notifyMilestone()。 */

/* 最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對「最
   外層 let/const」有相容性 bug（函式讀不到），var 沒有這個問題。
   函式內部的 let/const 不受影響，不用改。 */
var sharedSocket = null;

// 一載入這個腳本就馬上開始連線（不要等到要送里程碑事件的那一刻才開始
// 連，不然連線根本還沒 OPEN，訊息會送不出去）；開不了就是 null，之後
// 的呼叫都會靜默略過。
try {
  var scheme = location.protocol === "https:" ? "wss" : "ws";
  sharedSocket = new WebSocket(`${scheme}://${location.host}/ws`);
  sharedSocket.onclose = () => (sharedSocket = null);
  sharedSocket.onerror = () => {};   // 連不上很正常，不要吵
} catch (e) {
  sharedSocket = null; // 開本機檔案等情況，直接當作沒有伺服器
}

function connectVision({ onStatus, onFingers, onAnswer }) {
  const ws = sharedSocket;
  if (!ws) return;

  ws.addEventListener("open", () => onStatus && onStatus(true));
  ws.addEventListener("close", () => onStatus && onStatus(false));

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "fingers" && onFingers) onFingers(msg.count);
    if (msg.type === "answer" && onAnswer) onAnswer(msg.count);
  });
}

// 遊戲破了大目標時呼叫這個：連著伺服器就會讓 SwitchBot 按一下實體按鈕
function notifyMilestone() {
  if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) return;
  try {
    sharedSocket.send(JSON.stringify({ type: "milestone" }));
  } catch (e) {
    // 送不出去就算了，不影響遊戲
  }
}

// 跟讀小鸚鵡用：請伺服器用筆電麥克風錄音辨識，講完會呼叫 onHeard({ text, error })
// text 是聽到的文字（null 表示沒聽清楚或沒開麥克風），error 是原因代碼
function listenForSpeech(onHeard) {
  if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
    onHeard({ text: null, error: "no_server" });
    return;
  }

  const timeout = setTimeout(() => {
    sharedSocket.removeEventListener("message", handler);
    onHeard({ text: null, error: "timeout" });
  }, 8000); // 錄音＋辨識正常幾秒內會回來，太久就當作失敗，不要讓畫面卡住

  function handler(event) {
    const msg = JSON.parse(event.data);
    if (msg.type !== "heard") return;
    clearTimeout(timeout);
    sharedSocket.removeEventListener("message", handler);
    onHeard({ text: msg.text, error: msg.error });
  }

  sharedSocket.addEventListener("message", handler);
  try {
    sharedSocket.send(JSON.stringify({ type: "listen" }));
  } catch (e) {
    clearTimeout(timeout);
    sharedSocket.removeEventListener("message", handler);
    onHeard({ text: null, error: "no_server" });
  }
}
