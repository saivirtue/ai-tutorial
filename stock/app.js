/* 台股速查 — 畫面邏輯

   設計原則（跟這個頁面想解決的問題有關）：
   1. 只呈現「慢資料」——收盤價、估值、月營收、法人動向。刻意不做任何
      短期趨勢預測或買賣訊號，因為那是這件事裡最難、最多人做輸的部分。
   2. 定期定額紀錄簿完全存在本機，不需要任何 API，也不會離開你的瀏覽器。
   3. 三個視圖（查詢／自選／定期定額）用底部固定分頁列切換，不是一路往下
      滑的長條——定期定額尤其獨立成跨股票的總覽，不是掛在某一檔底下。 */

var WATCH_KEY = "tw-stock-watchlist";
var DCA_KEY = "tw-stock-dca";

var state = {
  data: {},      // { daily: {code:…}, valuation: {…}, revenue: {…}, institution: {…} }
  status: [],    // 各資料源的成敗
  list: [],      // 全部個股 [{ code, name }]，給搜尋用
  pools: null,   // 估值分布（全市場＋各產業），算百分位用
  meta: null,
  view: "search",  // "search" | "watchlist" | "dca"
  current: null,   // 查詢分頁：目前選中的代號
  dcaCode: null,   // 定期定額分頁：目前打開的個股帳本；null = 顯示總覽
  marketHistory: [],  // 全市場估值中位數的歷史序列，每個交易日一筆
  etfRank: [],         // 定期定額交易戶數排行（證交所給幾名就顯示幾名，目前實測是前 20 名）
  priceHistory: {},    // 每檔逐日累積的收盤價，算「近一年報酬」用
  valuationHistory: {}, // 每檔逐日累積的本益比／殖利率，算「跟自己過去比」的河流圖用
};

/* ===== 小工具 ===== */

function $(id) {
  return document.getElementById(id);
}

/* 股票名稱來自政府 API，理論上乾淨，但既然要走 innerHTML 就一律跳脫，
   不要因為「應該不會有問題」而留一個洞。 */
function esc(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(value, digits) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits === undefined ? 2 : digits,
    maximumFractionDigits: digits === undefined ? 2 : digits,
  });
}

function fmtInt(value) {
  return value === null || value === undefined
    ? "—"
    : Math.round(value).toLocaleString("zh-TW");
}

/* 台股慣例：紅色 = 上漲，綠色 = 下跌（跟歐美反過來，別弄錯）。 */
function trendClass(value) {
  if (value === null || value === undefined || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function withSign(value, digits) {
  if (value === null || value === undefined) return "—";
  return (value > 0 ? "+" : "") + fmt(value, digits);
}

function statCell(label, value) {
  return (
    '<div class="stat">' +
    '<div class="stat-label">' + esc(label) + "</div>" +
    '<div class="stat-value">' + value + "</div>" +
    "</div>"
  );
}

function subNote(text) {
  return '<div class="sub-note">' + esc(text) + "</div>";
}

function unavailableCard(title, what) {
  return (
    '<div class="card muted">' +
    "<h3>" + esc(title) + "</h3>" +
    '<p class="empty">這檔沒有' + esc(what) + "的資料，" +
    "或該資料源這次沒抓到（見右上角 ⚙ 資料源狀態）。</p>" +
    "</div>"
  );
}

/* ===== localStorage 存取（無痕模式會丟例外，一律包起來） ===== */

function readJson(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 存不進去就算了，畫面照常運作 */
  }
}

function getWatchlist() {
  var list = readJson(WATCH_KEY, []);
  return Array.isArray(list) ? list : [];
}

function getDca(code) {
  var all = readJson(DCA_KEY, {});
  var entries = all && all[code];
  return Array.isArray(entries) ? entries : [];
}

function setDca(code, entries) {
  var all = readJson(DCA_KEY, {});
  if (!all || typeof all !== "object") all = {};
  if (entries.length) all[code] = entries;
  else delete all[code];
  writeJson(DCA_KEY, all);
}

/* 有紀錄的股票代號列表——定期定額總覽要列出每一檔 */
function getDcaCodes() {
  var all = readJson(DCA_KEY, {});
  return all && typeof all === "object" ? Object.keys(all) : [];
}

/* ===== 啟動 ===== */

async function boot() {
  $("proxy-input").value = getProxy();
  $("loading").textContent = "正在跟證交所要資料…";

  var loaded = await Promise.all([
    loadAll(),
    fetchMarketHistory(),
    fetchEtfRank(),
    fetchPriceHistory(),
    fetchValuationHistory(),
  ]);
  var result = loaded[0];
  state.data = result.data;
  state.status = result.status;
  state.marketHistory = loaded[1];
  state.etfRank = loaded[2];
  state.priceHistory = loaded[3];
  state.valuationHistory = loaded[4];

  var daily = state.data.daily;
  if (!daily || !Object.keys(daily).length) {
    /* 主要資料源掛了，整頁沒東西可看。這時候最重要的是講清楚為什麼，
       而不是留一個空白畫面。 */
    $("loading").innerHTML =
      '<div class="fatal">' +
      "<strong>抓不到證交所的資料。</strong><br>" +
      "最可能是瀏覽器的 CORS 限制擋住了跨域請求。" +
      "點右上角 ⚙ 看「資料源狀態」裡每一個端點的實際錯誤訊息，" +
      "或在裡面設定一個 proxy 前綴再重新整理。" +
      "</div>";
    renderStatus();
    return;
  }

  state.list = Object.keys(daily)
    .map(function (code) {
      return { code: code, name: daily[code].name };
    })
    .sort(function (a, b) {
      return a.code.localeCompare(b.code);
    });

  state.pools = buildPercentiles(state.data.valuation || {}, state.data.revenue || {});
  state.meta = result.meta;

  $("loading").style.display = "none";
  $("app").style.display = "block";
  $("tabbar").style.display = "flex";
  $("market-count").textContent = state.list.length;
  renderDataDate();
  renderStatus();

  bindEvents();
  switchView("search");
}

/* ===== 分頁切換 ===== */

var VIEWS = ["search", "watchlist", "dca"];

function switchView(view) {
  state.view = view;

  VIEWS.forEach(function (v) {
    $("view-" + v).hidden = v !== view;
  });

  Array.prototype.forEach.call(document.querySelectorAll("#tabbar button"), function (btn) {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  if (view === "watchlist") renderWatchlistView();
  if (view === "dca") renderDcaView();

  window.scrollTo(0, 0);
}

function bindEvents() {
  var input = $("search-input");

  input.addEventListener("input", function () {
    renderSearch(input.value);
  });

  /* 只有一個結果時按 Enter 直接開它，省一次點擊 */
  input.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var matches = search(input.value);
    if (matches.length) selectStock(matches[0].code);
  });

  Array.prototype.forEach.call(document.querySelectorAll("#tabbar button"), function (btn) {
    btn.addEventListener("click", function () {
      switchView(btn.dataset.view);
    });
  });

  $("settings-btn").addEventListener("click", function () {
    $("settings-panel").hidden = false;
  });
  $("settings-close").addEventListener("click", function () {
    $("settings-panel").hidden = true;
  });

  $("proxy-save").addEventListener("click", function () {
    setProxy($("proxy-input").value.trim());
    location.reload();
  });

  $("dca-clear-all").addEventListener("click", clearAllDca);
}

/* 一次清空所有定期定額紀錄——主要是給測試用的假資料收尾，不用逐檔逐筆
   點刪除。只清 DCA_KEY，自選清單（WATCH_KEY）不受影響。清掉前用
   confirm() 講清楚會刪多少、講清楚不能復原，這是真的會清掉資料的操作，
   不能只靠一個按鈕就動手。 */
function clearAllDca() {
  var codes = getDcaCodes();
  if (!codes.length) {
    alert("目前沒有任何定期定額紀錄，不用清。");
    return;
  }

  var totalEntries = codes.reduce(function (sum, code) {
    return sum + getDca(code).length;
  }, 0);

  var ok = confirm(
    "確定要清空全部定期定額紀錄嗎？\n\n" +
      "將刪除 " + codes.length + " 檔、共 " + totalEntries + " 筆扣款紀錄。\n" +
      "這個動作不能復原（自選清單不受影響）。"
  );
  if (!ok) return;

  writeJson(DCA_KEY, {});
  state.dcaCode = null;

  if (state.view === "dca") renderDcaView();
  if (state.current) renderDetail(); // 明細卡片上的「💰 定期定額」按鈕亮起狀態要跟著更新
}

/* ===== 查詢分頁 ===== */

function search(query) {
  var q = String(query || "").trim().toLowerCase();
  if (!q) return [];

  return state.list
    .filter(function (item) {
      /* 代號用「開頭符合」，名稱用「包含」——打 2330 不會撈出一堆
         代號裡剛好有 2330 的東西，但打「台積」還是找得到台積電。 */
      return (
        item.code.indexOf(q) === 0 ||
        item.name.toLowerCase().indexOf(q) >= 0
      );
    })
    .slice(0, 30);
}

function renderSearch(query) {
  var box = $("search-results");
  var matches = search(query);

  if (!matches.length) {
    box.innerHTML = String(query || "").trim()
      ? '<div class="empty">找不到符合的股票</div>'
      : "";
    return;
  }

  var watching = getWatchlist();

  box.innerHTML = matches
    .map(function (item) {
      var d = state.data.daily[item.code];
      var starred = watching.indexOf(item.code) >= 0;
      return (
        '<button class="result-row" data-code="' + esc(item.code) + '">' +
        (starred ? '<span class="star-badge">★</span>' : "") +
        '<span class="code">' + esc(item.code) + "</span>" +
        '<span class="name">' + esc(item.name) + "</span>" +
        '<span class="price ' + trendClass(d.change) + '">' +
        fmt(d.close) +
        "</span>" +
        "</button>"
      );
    })
    .join("");

  Array.prototype.forEach.call(box.querySelectorAll(".result-row"), function (el) {
    el.addEventListener("click", function () {
      selectStock(el.dataset.code);
    });
  });
}

/* 打開個股明細。清掉搜尋結果列表——不然明細會被壓到一長串結果下面，
   每次都要滑過去才看得到剛選的東西。 */
function selectStock(code) {
  state.current = code;
  $("search-results").innerHTML = "";
  renderDetail();
  if (state.view !== "search") switchView("search");
  else window.scrollTo(0, 0);
}

function renderDetail() {
  var code = state.current;
  var box = $("detail");
  if (!code) {
    box.innerHTML = "";
    return;
  }

  var d = state.data.daily[code];
  if (!d) {
    box.innerHTML = '<div class="empty">查不到這個代號</div>';
    return;
  }

  var changePct =
    d.change !== null && d.close !== null && d.close - d.change !== 0
      ? (d.change / (d.close - d.change)) * 100
      : null;

  var watching = getWatchlist().indexOf(code) >= 0;
  var hasDca = getDca(code).length > 0;

  box.innerHTML =
    '<div class="card">' +
    '  <div class="detail-head">' +
    "    <div>" +
    '      <div class="detail-name">' + esc(d.name) + "</div>" +
    '      <div class="detail-code">' + esc(code) + "</div>" +
    "    </div>" +
    '    <div class="detail-actions">' +
    '      <button class="watch-btn' + (watching ? " on" : "") + '" id="watch-toggle">' +
    (watching ? "★ 已在自選" : "☆ 加入自選") +
    "      </button>" +
    '      <button class="watch-btn' + (hasDca ? " on" : "") + '" id="goto-dca">' +
    "💰 定期定額" +
    "      </button>" +
    "    </div>" +
    "  </div>" +
    '  <div class="quote ' + trendClass(d.change) + '">' +
    '    <span class="quote-price">' + fmt(d.close) + "</span>" +
    '    <span class="quote-change">' +
    withSign(d.change) +
    (changePct === null ? "" : "（" + withSign(changePct) + "%）") +
    "    </span>" +
    "  </div>" +
    '  <div class="grid">' +
    statCell("開盤", fmt(d.open)) +
    statCell("最高", fmt(d.high)) +
    statCell("最低", fmt(d.low)) +
    statCell("成交量", fmtInt(d.volume === null ? null : d.volume / 1000) + " 張") +
    "  </div>" +
    "</div>" +
    renderPriceHistory(code) +
    renderValuation(code) +
    renderValuationHistory(code) +
    renderRevenue(code) +
    renderInstitution(code);

  $("watch-toggle").addEventListener("click", function () {
    toggleWatch(code);
  });
  $("goto-dca").addEventListener("click", function () {
    state.dcaCode = code;
    switchView("dca");
  });
}

/* ===== 價格歷史 =====
   兩個數字，來源不一樣、意義也不一樣，不要混為一談：

   「今年最高/最低/均價」來自證交所的 FMNPTK_ALL，馬上就有、但只是
   西元今年 1 月以來的區間，不是「近一年」。

   「近一年報酬」證交所沒有現成端點——openapi.twse.com.tw 沒有參數能
   指定查哪一年，唯一誠實的辦法是自己逐日累積收盤價（見 stock-data.yml），
   累積不滿約 300 個交易日前，這裡只會顯示「累積中」，不假裝算得出來。

   兩者都刻意不帶任何判斷語氣——這是歷史紀錄，不是預測，過去漲跌不代表
   接下來會怎樣，不建議當加減碼依據。 */
var PRICE_HISTORY_MIN_DAYS = 300; // 至少要有這麼多天，「近一年」才算數

function computeTrailingReturn(code) {
  var h = (state.priceHistory || {})[code];
  if (!h || !h.d || !h.d.length) return null;

  if (h.d.length < PRICE_HISTORY_MIN_DAYS) {
    return { ready: false, days: h.d.length };
  }

  var fromDate = h.d[0];
  var fromClose = h.c[0];
  var toDate = h.d[h.d.length - 1];
  var toClose = h.c[h.c.length - 1];

  if (!(fromClose > 0) || toClose === null || toClose === undefined) {
    return { ready: false, days: h.d.length };
  }

  return {
    ready: true,
    days: h.d.length,
    fromDate: fromDate,
    fromClose: fromClose,
    toDate: toDate,
    toClose: toClose,
    pct: ((toClose - fromClose) / fromClose) * 100,
  };
}

function renderPriceHistory(code) {
  var yr = (state.data.yearRange || {})[code];
  var trailing = computeTrailingReturn(code);

  if (!yr && !trailing) {
    return unavailableCard("價格歷史", "去年價格區間或近一年報酬");
  }

  var cells = "";

  if (yr) {
    /* 一開始誤以為 FMNPTK_ALL 是「今年至今」，實測發現 Year 欄位固定回
       「去年」——證交所要等一整年結束才會出這份年度統計，不是即時累計。
       標籤跟著資料本身的年份走（yr.year），不要寫死「今年」。 */
    var yLabel = yr.year ? yr.year + "年" : "去年";
    cells +=
      statCell(yLabel + "最高", fmt(yr.high) + (yr.highDate ? subNote(yr.highDate) : "")) +
      statCell(yLabel + "最低", fmt(yr.low) + (yr.lowDate ? subNote(yr.lowDate) : "")) +
      statCell(yLabel + "均價", fmt(yr.avgClose));
  }

  if (trailing && trailing.ready) {
    cells += statCell(
      "近一年報酬",
      '<span class="' + trendClass(trailing.pct) + '">' + withSign(trailing.pct) + "%</span>" +
        subNote("與 " + trailing.fromDate + " 收盤 " + fmt(trailing.fromClose) + " 相比")
    );
  } else {
    var days = trailing ? trailing.days : 0;
    cells += statCell(
      "近一年報酬",
      "累積中" + subNote(days + " / 約 " + PRICE_HISTORY_MIN_DAYS + " 個交易日")
    );
  }

  return (
    '<div class="card">' +
    '<h3>價格歷史 <span class="tag">純紀錄，非預測</span></h3>' +
    '<div class="grid">' + cells + "</div>" +
    '<p class="caveat">' +
    (yr
      ? "「" + (yr.year ? yr.year + "年" : "去年") + "最高／最低／均價」是證交所公布的<strong>已完整結束的年度</strong>" +
        "統計，不是「今年至今」——這個端點要等一整年過完才會出資料；"
      : "") +
    "「近一年報酬」是這個功能上線後逐日累積收盤價自己算出來的，累積不滿約 " +
    PRICE_HISTORY_MIN_DAYS + " 個交易日前會顯示「累積中」，會需要時間。" +
    "這兩者都是<strong>歷史紀錄，不是預測</strong>，過去漲跌不代表接下來會怎樣，不建議當加減碼依據。</p>" +
    "</div>"
  );
}

/* 估值：數字本身沒有感覺，加上「相對位置」才讀得懂。
   有產業別就跟同業比——金融股和 IC 設計的合理本益比本來就不同，
   拿全市場一起排意義不大。同業樣本太少（< 5 檔）時才退回全市場。 */
function renderValuation(code) {
  var v = (state.data.valuation || {})[code];
  if (!v) {
    return unavailableCard("估值", "本益比 / 殖利率 / 股價淨值比");
  }

  var rev = (state.data.revenue || {})[code];
  var industry = rev && rev.industry;
  var industryPool = industry ? state.pools.byIndustry[industry] : null;
  var useIndustry = !!(industryPool && industryPool.pe.length >= 5);

  var basis = useIndustry ? industryPool : state.pools.market;
  var scope = useIndustry ? industry : "全市場";
  var sampleSize = useIndustry ? industryPool.pe.length : state.pools.market.pe.length;

  var pePct = percentile(basis.pe, v.pe);
  var yieldPct = percentile(basis.yield, v.yield);
  var pbPct = percentile(basis.pb, v.pb);

  return (
    '<div class="card">' +
    '<h3>估值 <span class="tag">慢資料</span>' +
    (useIndustry ? ' <span class="tag">與' + esc(industry) + "同業比較</span>" : "") +
    "</h3>" +
    '<div class="grid">' +
    statCell(
      "本益比",
      fmt(v.pe) + (pePct === null ? "" : subNote("比" + scope + " " + pePct + "% 的股票貴"))
    ) +
    statCell(
      "殖利率",
      fmt(v.yield) + "%" +
        (yieldPct === null ? "" : subNote("贏過" + scope + " " + yieldPct + "% 的股票"))
    ) +
    statCell(
      "股價淨值比",
      fmt(v.pb) + (pbPct === null ? "" : subNote("比" + scope + " " + pbPct + "% 的股票高"))
    ) +
    "</div>" +
    '<p class="caveat">' +
    (useIndustry
      ? "百分位是跟<strong>" + esc(industry) + "</strong>的其他 " + (sampleSize - 1) +
        " 檔一起排出來的。同業比較才有意義，但同一個產業裡的公司規模與商業模式仍可能差很多。"
      : "這檔沒有產業別資料（ETF 和少數標的沒有），所以百分位是拿<strong>全部上市股票</strong>一起排的" +
        "<strong>跨產業</strong>比較——金融股和 IC 設計的合理本益比本來就不一樣，只能當粗略參考。") +
    "這些是估值的相對位置，不是買賣建議。</p>" +
    "</div>"
  );
}

/* ===== 估值河流圖 =====
   上面的「估值」卡片比的是「跟同業今天比」；這裡比的是「跟這檔自己
   過去比」——是完全不同的兩種相對位置，卡片標題和文字都要講清楚，
   不然使用者會被兩個「百分位」搞混。

   跟大盤估值概況（renderMarketOverview）同一套邏輯：累積不滿一段時間
   前只顯示原始數字，不假裝算得出來。門檻沿用同樣的天數——沒有理由
   個股跟大盤用不同標準。 */
function renderValuationHistory(code) {
  var h = (state.valuationHistory || {})[code];
  if (!h || !h.d || !h.d.length) {
    return unavailableCard("估值河流圖", "本益比／殖利率的歷史走勢");
  }

  var days = h.d.length;
  var todayPe = h.pe[h.pe.length - 1];
  var todayY = h.y[h.y.length - 1];

  var peSeries = h.pe
    .filter(function (v) { return v !== null && v > 0; })
    .sort(function (a, b) { return a - b; });
  var ySeries = h.y
    .filter(function (v) { return v !== null && v > 0; })
    .sort(function (a, b) { return a - b; });

  var enoughPct = days >= MARKET_MIN_FOR_PERCENTILE;
  var pePct = enoughPct && todayPe !== null && todayPe > 0
    ? percentile(peSeries, todayPe)
    : null;
  var yPct = enoughPct && todayY !== null && todayY > 0
    ? percentile(ySeries, todayY)
    : null;

  var spark = days >= MARKET_MIN_FOR_SPARK
    ? buildSparkline(h.pe.filter(function (v) { return v !== null; }))
    : "";

  return (
    '<div class="card">' +
    "<h3>估值河流圖 <span class=\"tag\">跟自己過去比</span></h3>" +
    '<div class="grid">' +
    statCell(
      "本益比",
      fmt(todayPe) +
        (pePct === null
          ? ""
          : subNote("比這檔過去 " + days + " 個交易日中的 " + pePct + "% 都高（相對較貴）"))
    ) +
    statCell(
      "殖利率",
      fmt(todayY) + "%" +
        (yPct === null
          ? ""
          : subNote("比這檔過去 " + days + " 個交易日中的 " + yPct + "% 都高"))
    ) +
    "</div>" +
    (spark
      ? '<div class="spark-wrap">' + spark +
        '<div class="spark-labels"><span>' + esc(h.d[0]) + "</span><span>" +
        esc(h.d[days - 1]) + "</span></div></div>"
      : "") +
    '<p class="caveat">' +
    (enoughPct
      ? "「相對較貴／便宜」是跟<strong>這檔自己過去 " + days + " 個交易日</strong>比，" +
        "不是跟同業比（同業比較在上面「估值」卡片）。"
      : "資料只有 " + days + " 個交易日，還不夠算相對位置（至少需要 " +
        MARKET_MIN_FOR_PERCENTILE + " 天）。") +
    "這不是預測，過去的估值高低不代表接下來會怎樣，不建議當加減碼依據。</p>" +
    "</div>"
  );
}

function renderRevenue(code) {
  var r = (state.data.revenue || {})[code];
  if (!r) {
    return unavailableCard("月營收", "月營收年增率");
  }

  return (
    '<div class="card">' +
    "<h3>月營收" +
    (r.month ? ' <span class="tag">' + esc(r.month) + "</span>" : "") +
    (r.industry ? ' <span class="tag">' + esc(r.industry) + "</span>" : "") +
    "</h3>" +
    '<div class="grid">' +
    statCell("當月營收", fmtInt(r.current) + " 千元") +
    statCell(
      "年增率 (YoY)",
      '<span class="' + trendClass(r.yoyPct) + '">' + withSign(r.yoyPct) + "%</span>"
    ) +
    statCell(
      "月增率 (MoM)",
      '<span class="' + trendClass(r.momPct) + '">' + withSign(r.momPct) + "%</span>"
    ) +
    statCell("今年累計", fmtInt(r.ytd) + " 千元") +
    statCell(
      "累計年增率",
      '<span class="' + trendClass(r.ytdPct) + '">' + withSign(r.ytdPct) + "%</span>"
    ) +
    "</div>" +
    '<p class="caveat">月增率受淡旺季影響很大，看<strong>年增率</strong>比較有意義；' +
    "而單月的年增率也會被去年的基期高低扭曲，<strong>累計年增率</strong>雜訊最小。" +
    "任何一個月的數字都不該單獨解讀，要看連續幾個月的方向。</p>" +
    "</div>"
  );
}

function renderInstitution(code) {
  var t = (state.data.institution || {})[code];
  if (!t) {
    return unavailableCard("三大法人", "外資／投信當日買賣超");
  }

  /* 原始單位是「股」，台股習慣講「張」（1 張 = 1000 股） */
  function lots(shares) {
    return shares === null
      ? "—"
      : '<span class="' + trendClass(shares) + '">' +
          withSign(shares / 1000, 0) +
          "</span>";
  }

  return (
    '<div class="card">' +
    "<h3>三大法人買賣超（張）</h3>" +
    '<div class="grid">' +
    statCell("外資", lots(t.foreign)) +
    statCell("投信", lots(t.trust)) +
    statCell("自營商", lots(t.dealer)) +
    statCell("合計", lots(t.total)) +
    "</div>" +
    '<p class="caveat">這是<strong>單日</strong>資料。單一天的買賣超雜訊很大，' +
    "不要拿來當進出依據——真正有訊號的是連續多日的同方向累積。</p>" +
    "</div>"
  );
}

/* ===== 自選分頁 ===== */

function toggleWatch(code) {
  var list = getWatchlist();
  var idx = list.indexOf(code);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(code);
  writeJson(WATCH_KEY, list);

  renderDetail();
  renderSearch($("search-input").value);
  if (state.view === "watchlist") renderWatchlistView();
}

function renderWatchlistView() {
  var box = $("view-watchlist");
  var list = getWatchlist();

  var body = !list.length
    ? '<p class="empty">還沒有自選股。到「查詢」分頁找到想追蹤的，按「☆ 加入自選」。</p>'
    : '<div id="watchlist">' +
      list
        .map(function (code) {
          var d = state.data.daily[code];
          if (!d) {
            return (
              '<button class="watch-row" data-code="' + esc(code) + '">' +
              '<span class="code">' + esc(code) + "</span>" +
              '<span class="name">今日無資料</span>' +
              "</button>"
            );
          }
          var pct =
            d.change !== null && d.close !== null && d.close - d.change !== 0
              ? (d.change / (d.close - d.change)) * 100
              : null;
          return (
            '<button class="watch-row" data-code="' + esc(code) + '">' +
            '<span class="code">' + esc(code) + "</span>" +
            '<span class="name">' + esc(d.name) + "</span>" +
            '<span class="price ' + trendClass(d.change) + '">' + fmt(d.close) + "</span>" +
            '<span class="chg ' + trendClass(d.change) + '">' +
            (pct === null ? "—" : withSign(pct) + "%") +
            "</span>" +
            "</button>"
          );
        })
        .join("") +
      "</div>";

  box.innerHTML = '<h2 class="view-title">⭐ 我的自選</h2>' + body;

  Array.prototype.forEach.call(box.querySelectorAll(".watch-row"), function (el) {
    el.addEventListener("click", function () {
      selectStock(el.dataset.code);
    });
  });
}

/* ===== 定期定額分頁 =====
   跨股票的總覽，不是掛在某一檔明細底下。這一段完全不碰 API——證交所的
   免費資料沒有個股歷史股價，所以做不了真正的回測，與其用假設報酬率算一個
   看起來很專業但其實是編的數字，不如讓你把實際扣款記下來，算出真實的
   平均成本。 */

function computeDcaSummary(code) {
  var entries = getDca(code);
  var d = state.data.daily[code];
  var close = d ? d.close : null;

  var totalCost = 0;
  var totalShares = 0;
  entries.forEach(function (e) {
    totalCost += e.amount;
    if (e.price > 0) totalShares += e.amount / e.price;
  });

  var avgCost = totalShares > 0 ? totalCost / totalShares : null;
  var marketValue = close !== null ? totalShares * close : null;
  var profit = marketValue !== null ? marketValue - totalCost : null;
  var profitPct = profit !== null && totalCost > 0 ? (profit / totalCost) * 100 : null;

  return {
    entries: entries,
    close: close,
    totalCost: totalCost,
    totalShares: totalShares,
    avgCost: avgCost,
    marketValue: marketValue,
    profit: profit,
    profitPct: profitPct,
  };
}

function renderDcaView() {
  var box = $("view-dca");
  if (state.dcaCode) {
    box.innerHTML = renderDcaLedger(state.dcaCode);
    bindDcaLedgerEvents(state.dcaCode);
  } else {
    box.innerHTML = renderDcaOverview();
    bindDcaOverviewEvents();
  }
}

/* ===== 大盤估值概況 =====
   放在定期定額總覽最上方——「這個月要不要多扣一點」正是這個資訊該出現
   的時機，比放在查詢分頁更貼近實際用途。

   注意這不是「大盤本益比」：正規算法要市值加權，市值需要在外流通股數，
   免費 API 沒有這個資料。這裡算的是全市場本益比／殖利率的「中位數」，
   只用已經在抓的 daily/valuation 兩份資料算出來，每個交易日一筆，
   由 stock-data.yml 逐日累積進 market-history.json。也因為歷史是從
   這個功能上線那天才開始算，河流圖式的「跟自己過去幾年比」在資料還很少
   的時候沒有意義——樣本不足時只顯示原始數字，不假裝有結論。 */

var MARKET_MIN_FOR_PERCENTILE = 10;  // 至少要有這麼多天才顯示「相對位置」
var MARKET_MIN_FOR_SPARK = 5;        // 至少要有這麼多天才畫小圖

function renderMarketOverview() {
  var history = state.marketHistory || [];
  if (!history.length) {
    return (
      '<div class="card muted">' +
      "<h3>大盤估值概況</h3>" +
      '<p class="empty">還沒有資料——這個功能剛上線，資料會從今天開始每天累積。</p>' +
      "</div>"
    );
  }

  var today = history[history.length - 1];
  var days = history.length;
  var peSeries = history.map(function (h) { return h.peMedian; }).filter(function (v) { return v !== null; });
  var yieldSeries = history.map(function (h) { return h.yieldMedian; }).filter(function (v) { return v !== null; });

  var enoughForPct = days >= MARKET_MIN_FOR_PERCENTILE;
  var pePct = enoughForPct ? percentile(peSeries.slice().sort(function (a, b) { return a - b; }), today.peMedian) : null;
  var yieldPct = enoughForPct ? percentile(yieldSeries.slice().sort(function (a, b) { return a - b; }), today.yieldMedian) : null;

  var spark = days >= MARKET_MIN_FOR_SPARK ? buildSparkline(peSeries) : "";

  return (
    '<div class="card">' +
    "<h3>大盤估值概況 <span class=\"tag\">全市場中位數</span></h3>" +
    '<div class="grid">' +
    statCell(
      "本益比中位數",
      fmt(today.peMedian) +
        (pePct === null
          ? ""
          : subNote("比過去 " + days + " 個交易日中的 " + pePct + "% 都高（相對較貴）"))
    ) +
    statCell(
      "殖利率中位數",
      fmt(today.yieldMedian) + "%" +
        (yieldPct === null
          ? ""
          : subNote("比過去 " + days + " 個交易日中的 " + yieldPct + "% 都高"))
    ) +
    "</div>" +
    (spark
      ? '<div class="spark-wrap">' + spark +
        '<div class="spark-labels"><span>' + esc(history[0].date) + "</span><span>" +
        esc(today.date) + "</span></div></div>"
      : "") +
    '<p class="caveat">' +
    (enoughForPct
      ? "「相對較貴／便宜」是跟<strong>自己過去 " + days + " 個交易日</strong>比，不是跟其他市場比。"
      : "資料只有 " + days + " 個交易日，還不夠算相對位置（至少需要 " + MARKET_MIN_FOR_PERCENTILE + " 天）。") +
    "這不是官方公布的「大盤本益比」——正規算法要市值加權，免費資料沒有在外流通股數算不出來，" +
    "這裡是全市場的<strong>中位數</strong>，比較抗少數極端值干擾，但終究是自己算的，僅供參考。" +
    "傳統的本益比河流圖通常要幾年的資料才有意義，這裡的歷史從今天才開始累積，會需要時間。</p>" +
    "</div>"
  );
}

/* 用目前累積的歷史畫一條極簡的折線圖（inline SVG，沒有任何外部套件）。
   不用漲跌紅綠配色——本益比走高不必然是「壞事」，用中性的強調色，
   把「貴／便宜」的判斷留給旁邊的文字說明。 */
function buildSparkline(values) {
  if (!values || values.length < 2) return "";

  var width = 280;
  var height = 48;
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  var range = max - min || 1; // 全部數值相同時避免除以 0

  var stepX = width / (values.length - 1);
  var points = values
    .map(function (v, i) {
      var x = i * stepX;
      var y = height - ((v - min) / range) * height;
      return x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");

  var lastIdx = values.length - 1;
  var lastX = lastIdx * stepX;
  var lastY = height - ((values[lastIdx] - min) / range) * height;

  return (
    '<svg class="spark" viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none">' +
    '<polyline points="' + points + '" fill="none" stroke="currentColor" ' +
    'stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
    '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="3" fill="currentColor"/>' +
    "</svg>"
  );
}

/* ===== 定期定額熱門標的 =====
   證交所自己統計的定期定額交易戶數排行，個股和 ETF 分開列（名次數量
   由證交所決定，不在前端寫死——實測目前給的是前 20 名）。
   放在定期定額總覽——「不知道要扣什麼」時，這裡是找靈感的地方，剛好接在
   「新增扣款」的搜尋框前面。原本放在查詢分頁最上方會擋到搜尋，改到這裡。

   回傳 HTML 字串（不是直接操作 DOM）——要接在 renderDcaOverview() 組出來
   的一大串 HTML 裡，事件綁定跟總覽的其他部分一樣，統一交給
   bindDcaOverviewEvents() 在插入畫面後才做。沒有資料就回傳空字串，
   不佔位置。 */
function buildEtfRankHtml() {
  var rows = state.etfRank || [];
  if (!rows.length) return "";

  function col(code, name, accounts) {
    if (!code) return '<div class="rank-cell empty">—</div>';
    return (
      '<button class="rank-cell" data-code="' + esc(code) + '">' +
      '<span class="rank-name">' + esc(name) + "</span>" +
      '<span class="rank-code">' + esc(code) + "</span>" +
      '<span class="rank-accounts">' + fmtInt(accounts) + " 戶</span>" +
      "</button>"
    );
  }

  return (
    '<div class="card">' +
    "<h3>🔥 定期定額熱門標的 <span class=\"tag\">交易戶數排行</span></h3>" +
    '<div class="rank-table">' +
    '<div class="rank-head"><span>個股</span><span>ETF</span></div>' +
    rows
      .map(function (r) {
        return (
          '<div class="rank-row">' +
          '<span class="rank-no">' + (r.rank || "") + "</span>" +
          col(r.stockCode, r.stockName, r.stockAccounts) +
          col(r.etfCode, r.etfName, r.etfAccounts) +
          "</div>"
        );
      })
      .join("") +
    "</div>" +
    '<p class="caveat">證交所公布的定期定額交易戶數排行，反映的是<strong>大家實際在扣款什麼</strong>，' +
    "不是漲跌訊號——戶數多不代表報酬會好，只是提供一個「別人在看什麼」的起點。</p>" +
    "</div>"
  );
}

function renderDcaOverview() {
  var codes = getDcaCodes();
  var rows = codes.map(function (code) {
    var name = (state.data.daily[code] || {}).name || code;
    return { code: code, name: name, s: computeDcaSummary(code) };
  });

  var totalCost = 0;
  var totalMarket = 0;
  var hasAllPrices = true;
  rows.forEach(function (r) {
    totalCost += r.s.totalCost;
    if (r.s.marketValue !== null) totalMarket += r.s.marketValue;
    else hasAllPrices = false;
  });
  var totalProfit = hasAllPrices ? totalMarket - totalCost : null;
  var totalProfitPct = totalProfit !== null && totalCost > 0 ? (totalProfit / totalCost) * 100 : null;

  var body = !rows.length
    ? '<p class="empty">還沒有任何定期定額紀錄。在下面搜尋股票，新增第一筆扣款。</p>'
    : '<div class="grid">' +
      statCell("總投入", fmtInt(totalCost) + " 元") +
      statCell("總市值", hasAllPrices ? fmtInt(totalMarket) + " 元" : "—") +
      statCell(
        "總損益",
        totalProfit === null
          ? "—"
          : '<span class="' + trendClass(totalProfit) + '">' +
            withSign(totalProfit, 0) + " 元" +
            (totalProfitPct === null ? "" : subNote(withSign(totalProfitPct) + "%")) +
            "</span>"
      ) +
      "</div>" +
      '<div class="dca-holdings">' +
      rows
        .map(function (r) {
          return (
            '<button class="watch-row" data-code="' + esc(r.code) + '">' +
            '<span class="code">' + esc(r.code) + "</span>" +
            '<span class="name">' + esc(r.name) + "</span>" +
            '<span class="price">' + fmtInt(r.s.totalCost) + " 元</span>" +
            '<span class="chg ' + trendClass(r.s.profit) + '">' +
            (r.s.profitPct === null ? "—" : withSign(r.s.profitPct) + "%") +
            "</span>" +
            "</button>"
          );
        })
        .join("") +
      "</div>";

  return (
    '<h2 class="view-title">💰 定期定額</h2>' +
    renderMarketOverview() +
    body +
    buildEtfRankHtml() +
    '<h3 class="section-title">新增扣款</h3>' +
    '<input id="dca-search-input" type="search" placeholder="輸入股票代號或名稱" autocomplete="off">' +
    '<div id="dca-search-results"></div>' +
    '<p class="caveat">只存在這台裝置的瀏覽器裡，不會上傳。手動記下每次扣款，就能看到真實的平均成本。</p>'
  );
}

function bindDcaOverviewEvents() {
  Array.prototype.forEach.call($("view-dca").querySelectorAll(".dca-holdings .watch-row"), function (el) {
    el.addEventListener("click", function () {
      state.dcaCode = el.dataset.code;
      renderDcaView();
    });
  });

  /* 熱門標的排行的點擊——直接開該檔的定期定額帳本，不是跳去查詢分頁。
     這裡本來就是「不知道扣什麼、來找靈感」的情境，點了直接接上新增
     扣款的流程比較順，跟上面「我的持股」點進去是同一個目的地。 */
  Array.prototype.forEach.call($("view-dca").querySelectorAll(".rank-cell[data-code]"), function (el) {
    el.addEventListener("click", function () {
      state.dcaCode = el.dataset.code;
      renderDcaView();
    });
  });

  var input = $("dca-search-input");
  if (!input) return;

  input.addEventListener("input", function () {
    renderDcaSearch(input.value);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var matches = search(input.value);
    if (matches.length) {
      state.dcaCode = matches[0].code;
      renderDcaView();
    }
  });
}

function renderDcaSearch(query) {
  var box = $("dca-search-results");
  var matches = search(query);

  if (!matches.length) {
    box.innerHTML = String(query || "").trim()
      ? '<div class="empty">找不到符合的股票</div>'
      : "";
    return;
  }

  var tracked = getDcaCodes();

  box.innerHTML = matches
    .map(function (item) {
      var d = state.data.daily[item.code];
      var already = tracked.indexOf(item.code) >= 0;
      return (
        '<button class="result-row" data-code="' + esc(item.code) + '">' +
        (already ? '<span class="star-badge">●</span>' : "") +
        '<span class="code">' + esc(item.code) + "</span>" +
        '<span class="name">' + esc(item.name) + "</span>" +
        '<span class="price ' + trendClass(d.change) + '">' + fmt(d.close) + "</span>" +
        "</button>"
      );
    })
    .join("");

  Array.prototype.forEach.call(box.querySelectorAll(".result-row"), function (el) {
    el.addEventListener("click", function () {
      state.dcaCode = el.dataset.code;
      renderDcaView();
    });
  });
}

function renderDcaLedger(code) {
  var d = state.data.daily[code];
  var name = d ? d.name : code;
  var s = computeDcaSummary(code);

  var rows = s.entries
    .map(function (e, i) {
      return (
        "<tr>" +
        "<td>" + esc(e.date) + "</td>" +
        "<td>" + fmt(e.price) + "</td>" +
        "<td>" + fmtInt(e.amount) + "</td>" +
        "<td>" + fmt(e.price > 0 ? e.amount / e.price : null) + "</td>" +
        '<td><button class="del" data-index="' + i + '">刪除</button></td>' +
        "</tr>"
      );
    })
    .join("");

  return (
    '<button class="back-btn" id="dca-back">← 返回總覽</button>' +
    '<div class="detail-head">' +
    "<div>" +
    '<div class="detail-name">' + esc(name) + "</div>" +
    '<div class="detail-code">' + esc(code) + "</div>" +
    "</div>" +
    "</div>" +
    (d ? '<div class="quote-mini">目前股價 <span class="' + trendClass(d.change) + '">' + fmt(d.close) + "</span></div>" : "") +
    '<div class="dca-form">' +
    '  <label>扣款日<input type="date" id="dca-date"></label>' +
    '  <label>成交價<input type="number" id="dca-price" step="0.01" min="0" ' +
    'placeholder="' + (s.close === null ? "0.00" : fmt(s.close)) + '"></label>' +
    '  <label>金額（元）<input type="number" id="dca-amount" step="1" min="0" ' +
    'placeholder="3000"></label>' +
    '  <button class="primary" id="dca-add">新增扣款</button>' +
    "</div>" +
    (s.entries.length
      ? '<table class="dca-table">' +
        "<thead><tr><th>日期</th><th>價格</th><th>金額</th><th>股數</th><th></th></tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
        "</table>" +
        '<div class="grid dca-summary">' +
        statCell("累計投入", fmtInt(s.totalCost) + " 元") +
        statCell("累計股數", fmt(s.totalShares)) +
        statCell("平均成本", fmt(s.avgCost)) +
        statCell("目前股價", fmt(s.close)) +
        statCell("市值", fmtInt(s.marketValue) + " 元") +
        statCell(
          "損益",
          '<span class="' + trendClass(s.profit) + '">' +
            (s.profit === null ? "—" : withSign(s.profit, 0) + " 元") +
            (s.profitPct === null ? "" : subNote(withSign(s.profitPct) + "%")) +
            "</span>"
        ) +
        "</div>" +
        (s.avgCost !== null && s.close !== null && s.close < s.avgCost
          ? '<p class="caveat down-note">目前股價低於你的平均成本。' +
            "如果你還在扣款期、而且當初買它的理由沒變，這個月的錢會買到比平常更多的股數" +
            "——那正是定期定額運作的方式，不是它失效了。</p>"
          : "")
      : '<p class="empty">還沒有紀錄，填上面的表單新增第一筆。</p>')
  );
}

function bindDcaLedgerEvents(code) {
  $("dca-back").addEventListener("click", function () {
    state.dcaCode = null;
    renderDcaView();
  });

  var addBtn = $("dca-add");
  if (!addBtn) return;

  /* 預設帶今天和目前股價，多數情況直接填金額就好 */
  var d = state.data.daily[code];
  $("dca-date").value = new Date().toISOString().slice(0, 10);
  if (d && d.close !== null) $("dca-price").value = d.close;

  addBtn.addEventListener("click", function () {
    var date = $("dca-date").value;
    var price = Number($("dca-price").value);
    var amount = Number($("dca-amount").value);

    if (!date || !(price > 0) || !(amount > 0)) {
      alert("日期、成交價、金額都要填，而且價格和金額要大於 0。");
      return;
    }

    var entries = getDca(code);
    entries.push({ date: date, price: price, amount: amount });
    entries.sort(function (a, b) {
      return a.date.localeCompare(b.date);
    });
    setDca(code, entries);
    renderDcaView();
  });

  Array.prototype.forEach.call(document.querySelectorAll(".dca-table .del"), function (el) {
    el.addEventListener("click", function () {
      var entries = getDca(code);
      entries.splice(Number(el.dataset.index), 1);
      setDca(code, entries);
      renderDcaView();
    });
  });
}

/* ===== 資料源狀態 =====
   四個端點是各自獨立的，任何一個都可能因為證交所改路徑或 CORS 設定而失效。
   把每一個的結果攤開來，壞掉的時候才知道要修哪一個。 */

function renderStatus() {
  $("status-body").innerHTML = state.status
    .map(function (s) {
      return (
        '<div class="status-row ' + (s.ok ? "ok" : "fail") + '">' +
        '<span class="status-icon">' + (s.ok ? "✅" : "❌") + "</span>" +
        "<div>" +
        "<strong>" + esc(s.label) + "</strong>" +
        (s.required ? ' <span class="tag req">必要</span>' : "") +
        (s.ok && s.via ? ' <span class="tag">' + esc(s.via) + "</span>" : "") +
        '<div class="status-path">' + esc(s.path) + "</div>" +
        '<div class="status-detail">' +
        (s.ok
          ? "取得 " + s.count + " 檔（" + s.ms + " ms）"
          : esc(s.error)) +
        "</div>" +
        "</div>" +
        "</div>"
      );
    })
    .join("");
}

/* 資料日期：這一頁最容易被誤解的就是「這是哪一天的數字」。
   優先用個股資料裡的交易日，退而求其次用快照的產生時間。 */
function renderDataDate() {
  var box = $("data-date");
  if (!box) return;

  var daily = state.data.daily || {};
  var firstCode = Object.keys(daily)[0];
  var tradeDate = firstCode ? daily[firstCode].date : null;

  if (tradeDate) {
    box.textContent = "資料日期：" + tradeDate + "（收盤後）";
  } else if (state.meta && state.meta.fetchedAt) {
    box.textContent = "快照產生於 " + state.meta.fetchedAt;
  } else {
    box.textContent = "";
  }
}

boot();
