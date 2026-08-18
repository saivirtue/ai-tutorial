/* 台股速查 — 畫面邏輯

   設計原則（跟這個頁面想解決的問題有關）：
   1. 只呈現「慢資料」——收盤價、估值、月營收、法人動向。刻意不做任何
      短期趨勢預測或買賣訊號，因為那是這件事裡最難、最多人做輸的部分。
   2. 定期定額紀錄簿完全存在本機，不需要任何 API，也不會離開你的瀏覽器。 */

var WATCH_KEY = "tw-stock-watchlist";
var DCA_KEY = "tw-stock-dca";

var state = {
  data: {},      // { daily: {code:…}, valuation: {…}, revenue: {…}, institution: {…} }
  status: [],    // 各資料源的成敗
  list: [],      // 全部個股 [{ code, name }]，給搜尋用
  pools: null,   // 全市場估值分布，算百分位用
  current: null, // 目前選中的代號
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

/* ===== 啟動 ===== */

async function boot() {
  $("proxy-input").value = getProxy();
  $("loading").textContent = "正在跟證交所要資料…";

  var result = await loadAll();
  state.data = result.data;
  state.status = result.status;

  var daily = state.data.daily;
  if (!daily || !Object.keys(daily).length) {
    /* 主要資料源掛了，整頁沒東西可看。這時候最重要的是講清楚為什麼，
       而不是留一個空白畫面。 */
    $("loading").innerHTML =
      '<div class="fatal">' +
      "<strong>抓不到證交所的資料。</strong><br>" +
      "最可能是瀏覽器的 CORS 限制擋住了跨域請求。" +
      "往下看「資料源狀態」有每一個端點的實際錯誤訊息，" +
      "或在下面設定一個 proxy 前綴再重新整理。" +
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

  state.pools = buildPercentiles(state.data.valuation || {});

  $("loading").style.display = "none";
  $("main").style.display = "block";
  $("market-count").textContent = state.list.length;

  renderStatus();
  renderWatchlist();
  bindEvents();
}

/* ===== 搜尋 ===== */

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

  $("proxy-save").addEventListener("click", function () {
    setProxy($("proxy-input").value.trim());
    location.reload();
  });

  $("status-toggle").addEventListener("click", function () {
    var box = $("status-body");
    var open = box.style.display !== "none";
    box.style.display = open ? "none" : "block";
    $("status-toggle").textContent = open ? "▸ 資料源狀態" : "▾ 資料源狀態";
  });
}

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

  box.innerHTML = matches
    .map(function (item) {
      var d = state.data.daily[item.code];
      return (
        '<button class="result-row" data-code="' + esc(item.code) + '">' +
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

/* ===== 個股明細 ===== */

function selectStock(code) {
  state.current = code;
  renderDetail();
  $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
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

  box.innerHTML =
    '<div class="card">' +
    '  <div class="detail-head">' +
    "    <div>" +
    '      <div class="detail-name">' + esc(d.name) + "</div>" +
    '      <div class="detail-code">' + esc(code) + "</div>" +
    "    </div>" +
    '    <button class="watch-btn' + (watching ? " on" : "") + '" id="watch-toggle">' +
    (watching ? "★ 已在自選" : "☆ 加入自選") +
    "    </button>" +
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
    renderValuation(code) +
    renderRevenue(code) +
    renderInstitution(code) +
    renderDcaCard(code);

  $("watch-toggle").addEventListener("click", function () {
    toggleWatch(code);
  });

  bindDcaEvents(code);
}

function statCell(label, value) {
  return (
    '<div class="stat">' +
    '<div class="stat-label">' + esc(label) + "</div>" +
    '<div class="stat-value">' + value + "</div>" +
    "</div>"
  );
}

/* 估值：數字本身沒有感覺，加上「在全市場的相對位置」才讀得懂 */
function renderValuation(code) {
  var v = (state.data.valuation || {})[code];
  if (!v) {
    return unavailableCard("估值", "本益比 / 殖利率 / 股價淨值比");
  }

  var pePct = percentile(state.pools.pe, v.pe);
  var yieldPct = percentile(state.pools.yield, v.yield);
  var pbPct = percentile(state.pools.pb, v.pb);

  return (
    '<div class="card">' +
    '<h3>估值 <span class="tag">慢資料</span></h3>' +
    '<div class="grid">' +
    statCell(
      "本益比",
      fmt(v.pe) + (pePct === null ? "" : subNote("比全市場 " + pePct + "% 的股票貴"))
    ) +
    statCell(
      "殖利率",
      fmt(v.yield) + "%" +
        (yieldPct === null ? "" : subNote("贏過全市場 " + yieldPct + "% 的股票"))
    ) +
    statCell(
      "股價淨值比",
      fmt(v.pb) + (pbPct === null ? "" : subNote("比全市場 " + pbPct + "% 的股票高"))
    ) +
    "</div>" +
    '<p class="caveat">百分位是拿全部上市股票一起排的<strong>跨產業</strong>比較。' +
    "金融股和 IC 設計的合理本益比本來就不一樣，所以這是粗略的參考位置，不是估值結論。" +
    (v.yieldYear ? "殖利率依據 " + esc(v.yieldYear) + " 的股利。" : "") +
    "</p>" +
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
    "</div>" +
    '<p class="caveat">月增率受淡旺季影響很大，看<strong>年增率</strong>比較有意義。' +
    "單月數字本來就會跳，要看連續幾個月的方向。</p>" +
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

function unavailableCard(title, what) {
  return (
    '<div class="card muted">' +
    "<h3>" + esc(title) + "</h3>" +
    '<p class="empty">這檔沒有' + esc(what) + "的資料，" +
    "或該資料源這次沒抓到（見下方「資料源狀態」）。</p>" +
    "</div>"
  );
}

function subNote(text) {
  return '<div class="sub-note">' + esc(text) + "</div>";
}

/* ===== 自選 ===== */

function toggleWatch(code) {
  var list = getWatchlist();
  var idx = list.indexOf(code);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(code);
  writeJson(WATCH_KEY, list);
  renderWatchlist();
  renderDetail();
}

function renderWatchlist() {
  var list = getWatchlist();
  var box = $("watchlist");

  if (!list.length) {
    box.innerHTML =
      '<div class="empty">還沒有自選股。查到想追蹤的，按「☆ 加入自選」。</div>';
    return;
  }

  box.innerHTML = list
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
    .join("");

  Array.prototype.forEach.call(box.querySelectorAll(".watch-row"), function (el) {
    el.addEventListener("click", function () {
      selectStock(el.dataset.code);
    });
  });
}

/* ===== 定期定額紀錄簿 =====
   這一段完全不碰 API。證交所的免費資料沒有個股歷史股價，所以做不了真正的
   回測——與其用假設報酬率算一個看起來很專業但其實是編的數字，不如讓你把
   實際扣款記下來，算出真實的平均成本。 */

function renderDcaCard(code) {
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

  var rows = entries
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
    '<div class="card">' +
    "<h3>定期定額紀錄簿</h3>" +
    '<p class="caveat">只存在這台裝置的瀏覽器裡，不會上傳。' +
    "手動記下每次扣款，就能看到真實的平均成本。</p>" +
    '<div class="dca-form">' +
    '  <label>扣款日<input type="date" id="dca-date"></label>' +
    '  <label>成交價<input type="number" id="dca-price" step="0.01" min="0" ' +
    'placeholder="' + (close === null ? "0.00" : fmt(close)) + '"></label>' +
    '  <label>金額（元）<input type="number" id="dca-amount" step="1" min="0" ' +
    'placeholder="3000"></label>' +
    '  <button class="primary" id="dca-add">新增扣款</button>' +
    "</div>" +
    (entries.length
      ? '<table class="dca-table">' +
        "<thead><tr><th>日期</th><th>價格</th><th>金額</th><th>股數</th><th></th></tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
        "</table>" +
        '<div class="grid dca-summary">' +
        statCell("累計投入", fmtInt(totalCost) + " 元") +
        statCell("累計股數", fmt(totalShares)) +
        statCell("平均成本", fmt(avgCost)) +
        statCell("目前股價", fmt(close)) +
        statCell("市值", fmtInt(marketValue) + " 元") +
        statCell(
          "損益",
          '<span class="' + trendClass(profit) + '">' +
            (profit === null ? "—" : withSign(profit, 0) + " 元") +
            (profitPct === null ? "" : subNote(withSign(profitPct) + "%")) +
            "</span>"
        ) +
        "</div>" +
        (avgCost !== null && close !== null && close < avgCost
          ? '<p class="caveat down-note">目前股價低於你的平均成本。' +
            "如果你還在扣款期、而且當初買它的理由沒變，這個月的錢會買到比平常更多的股數" +
            "——那正是定期定額運作的方式，不是它失效了。</p>"
          : "")
      : '<p class="empty">還沒有紀錄。</p>') +
    "</div>"
  );
}

function bindDcaEvents(code) {
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
    renderDetail();
  });

  Array.prototype.forEach.call(document.querySelectorAll(".dca-table .del"), function (el) {
    el.addEventListener("click", function () {
      var entries = getDca(code);
      entries.splice(Number(el.dataset.index), 1);
      setDca(code, entries);
      renderDetail();
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

boot();
