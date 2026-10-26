/* 注音標示：一年級小孩還在學注音，題目裡的國字都要有注音才看得懂。
   ────────────────────────────────────────────────
   寫法：國字後面用 [ ] 放它的注音，其他字照常寫。
     "聽[ㄊㄧㄥ]一[ㄧ]聽[ㄊㄧㄥ]"
   轉成瀏覽器內建的 <ruby>（跟課本一樣，注音在國字上面）。
   一個字的注音寫在它後面；標點符號和英文不用寫注音。

   最外層變數用 var，不要用 let/const——某些電視盒的 WebView 對
   「最外層 let/const」有相容性 bug（函式讀不到）。 */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// "聽[ㄊㄧㄥ]" → '<ruby>聽<rt>ㄊㄧㄥ</rt></ruby>'
function zy(markup) {
  var out = "";
  var chars = Array.from(String(markup));
  for (var i = 0; i < chars.length; i++) {
    var c = chars[i];
    if (chars[i + 1] === "[") {
      var end = chars.indexOf("]", i + 2);
      if (end > 0) {
        var mark = chars.slice(i + 2, end).join("");
        out += "<ruby>" + escapeHtml(c) + "<rt>" + escapeHtml(mark) + "</rt></ruby>";
        i = end;
        continue;
      }
    }
    out += escapeHtml(c);
  }
  return out;
}

// 拿掉注音，只留國字（給語音唸、給比對用）："聽[ㄊㄧㄥ]一[ㄧ]聽" → "聽一聽"
function zyPlain(markup) {
  return String(markup).replace(/\[[^\]]*\]/g, "");
}

// 把標記好的文字放進元素（會附上 .zy，讓注音顯示得清楚）
function setZy(element, markup) {
  element.classList.add("zy");
  element.innerHTML = zy(markup);
}
