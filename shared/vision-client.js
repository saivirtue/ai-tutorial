/* 視覺輸入客戶端：連上筆電的鏡頭伺服器
   連不上（例如放在 GitHub Pages、或沒開伺服器）就靜默放棄，遊戲照常用觸控玩。 */

function connectVision({ onStatus, onFingers, onAnswer }) {
  let ws;
  try {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}/ws`);
  } catch (e) {
    return; // 開本機檔案等情況，直接當作沒有鏡頭
  }

  ws.onopen = () => onStatus && onStatus(true);
  ws.onclose = () => onStatus && onStatus(false);
  ws.onerror = () => {};   // 連不上很正常，不要吵

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "fingers" && onFingers) onFingers(msg.count);
    if (msg.type === "answer" && onAnswer) onAnswer(msg.count);
  };
}
