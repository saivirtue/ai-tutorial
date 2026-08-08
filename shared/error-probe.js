/* 暫時的診斷探針：問題排查完就可以整個刪掉（每個頁面 <head> 裡引用
   這支檔案的那行 <script> 也要一起拿掉）。

   只要頁面上任何 JS 出錯，就在螢幕最上方跳出紅色文字；也會在頁面
   一載入時就先顯示一次瀏覽器資訊（User-Agent、螢幕/視窗實際尺寸），
   點一下文字就會關掉，不會擋住遊戲畫面。

   刻意用最老派的寫法（var、function、字串相加，完全不用 const/let/
   箭頭函式/樣板字串），目的是就算瀏覽器連 ES6 語法都不支援、其他
   .js 檔案整個解析失敗，這支探針還是有機會跑起來，把真正的錯誤
   訊息秀在螢幕上，不用再用猜的。訊息刻意全用英文/ASCII，避免電視盒
   瀏覽器對外部 .js 檔案編碼判斷錯誤，中文變亂碼看不出訊息內容。 */

(function () {
  "use strict";

  function showBanner(text) {
    function append() {
      var box = document.createElement("div");
      box.setAttribute(
        "style",
        "position:fixed;top:0;left:0;right:0;z-index:999999;" +
          "background:#cc0000;color:#ffffff;font-size:16px;" +
          "padding:10px;white-space:pre-wrap;font-family:monospace;" +
          "line-height:1.4;cursor:pointer;"
      );
      box.appendChild(document.createTextNode(text + "\n(tap to dismiss)"));
      box.onclick = function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      };
      if (document.body) {
        document.body.appendChild(box);
      }
    }
    if (document.body) {
      append();
    } else {
      document.addEventListener("DOMContentLoaded", append);
    }
  }

  window.onerror = function (msg, url, line, col) {
    showBanner("JS ERROR: " + msg + "\nfile: " + url + " line " + line + " col " + col);
    return false;
  };

  window.addEventListener("unhandledrejection", function (event) {
    showBanner("PROMISE ERROR: " + event.reason);
  });

  // 順便印一下瀏覽器自己回報的資訊，之後有需要可以照這個再加更多欄位
  showBanner(
    "probe loaded OK. UA: " + navigator.userAgent +
      "\nscreen: " + screen.width + "x" + screen.height +
      "  viewport: " + window.innerWidth + "x" + window.innerHeight
  );
})();
