/* 台股資料層
   —— 資料原本來自臺灣證券交易所 OpenAPI，但**不是**由瀏覽器直接去抓。

   為什麼：實測證交所四個端點都沒有回 Access-Control-Allow-Origin，
   瀏覽器的同源政策會直接擋掉。解法不是架 proxy，而是利用「這些資料
   一天只變一次」——由 .github/workflows/stock-data.yml 每天收盤後抓好，
   把 JSON commit 進 stock/data/，網頁讀同源的靜態檔案。
   CORS 問題因此根本不存在，載入也快得多。

   讀取順序：
     1. data/<key>.json      同源快照（線上正常情況走這條）
     2. 直連證交所 / proxy    本機開發、或快照還沒產生時的退路

   ⚠️ 這裡全部是「收盤後的日頻資料」，不是盤中即時報價。

   最外層變數用 var，跟專案其他檔案一致（見 shared/game-utils.js 的說明）。 */

var TWSE_BASE = "https://openapi.twse.com.tw/v1/";
var SNAPSHOT_DIR = "data/";

/* ===== 直連時的 proxy 備援 =====
   只有在讀不到快照、必須直連證交所時才會用到（例如在本機開發）。
   填法兩種都支援：
     https://my-worker.dev/?url={url}   ← 有 {url} 就把網址編碼後代進去
     https://my-worker.dev/             ← 沒有就直接接在後面 */
var PROXY_KEY = "tw-stock-proxy";

function getProxy() {
  try {
    return localStorage.getItem(PROXY_KEY) || "";
  } catch (e) {
    return "";
  }
}

function setProxy(value) {
  try {
    localStorage.setItem(PROXY_KEY, value || "");
  } catch (e) {
    /* 無痕模式之類存不進去，忽略就好 */
  }
}

function apiUrl(path) {
  var direct = TWSE_BASE + path;
  var proxy = getProxy().trim();
  if (!proxy) return direct;
  if (proxy.indexOf("{url}") >= 0) {
    return proxy.replace("{url}", encodeURIComponent(direct));
  }
  return proxy + direct;
}

/* ===== 小工具 ===== */

/* 證交所的數字都是字串，有的帶千分位逗號，缺值用 "--"。
   一律轉成數字或 null，後面畫面才不用到處判斷。 */
function num(value) {
  if (value === null || value === undefined) return null;
  var s = String(value).replace(/,/g, "").trim();
  if (s === "" || s === "--" || s === "-" || s === "N/A") return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

/* 各個端點的欄位名稱不一致（有的叫 Code、有的叫「公司代號」），
   而且證交所偶爾會改。給一串候選名稱，挑第一個存在的。 */
function pick(row, names) {
  for (var i = 0; i < names.length; i++) {
    if (row[names[i]] !== undefined && row[names[i]] !== null) {
      return row[names[i]];
    }
  }
  return undefined;
}

function normCode(value) {
  return String(value === undefined ? "" : value).trim();
}

/* 民國日期字串（1150817）轉成看得懂的格式（2026-08-17） */
function rocDate(value) {
  var s = String(value || "").trim();
  if (!/^\d{7}$/.test(s)) return null;
  var year = Number(s.slice(0, 3)) + 1911;
  return year + "-" + s.slice(3, 5) + "-" + s.slice(5, 7);
}

/* 民國年月（11507）轉成 2026-07 */
function rocMonth(value) {
  var s = String(value || "").trim();
  if (!/^\d{5,6}$/.test(s)) return null;
  var cut = s.length - 2;
  return Number(s.slice(0, cut)) + 1911 + "-" + s.slice(cut);
}

/* ===== 資料源定義 =====
   每一個都獨立抓、獨立失敗。其中一個掛掉不會拖垮整頁——畫面上那張卡片
   會顯示「沒資料」，而且下方的「資料源狀態」會告訴你是哪個、為什麼。

   欄位名稱是拿真實回應核對過的（見 .github/workflows/twse-check.yml，
   那個工作流程會把實際欄位印出來）。 */
var SOURCES = [
  {
    key: "daily",
    label: "個股日成交資訊",
    path: "exchangeReport/STOCK_DAY_ALL",
    required: true,
    note: "收盤價、漲跌、成交量",
    normalize: function (rows) {
      var map = {};
      rows.forEach(function (row) {
        var code = normCode(pick(row, ["Code", "證券代號", "公司代號"]));
        if (!code) return;
        map[code] = {
          code: code,
          name: String(pick(row, ["Name", "證券名稱", "公司名稱"]) || "").trim(),
          date: rocDate(pick(row, ["Date"])),
          open: num(pick(row, ["OpeningPrice"])),
          high: num(pick(row, ["HighestPrice"])),
          low: num(pick(row, ["LowestPrice"])),
          close: num(pick(row, ["ClosingPrice"])),
          change: num(pick(row, ["Change"])),
          volume: num(pick(row, ["TradeVolume"])),
          turnover: num(pick(row, ["TradeValue"])),
          transactions: num(pick(row, ["Transaction"])),
        };
      });
      return map;
    },
  },
  {
    key: "valuation",
    label: "本益比 / 殖利率 / 股價淨值比",
    path: "exchangeReport/BWIBBU_ALL",
    required: false,
    note: "判斷「現在貴不貴」的慢資料",
    normalize: function (rows) {
      var map = {};
      rows.forEach(function (row) {
        var code = normCode(pick(row, ["Code", "證券代號", "公司代號"]));
        if (!code) return;
        map[code] = {
          pe: num(pick(row, ["PEratio", "PERatio", "本益比"])),
          yield: num(pick(row, ["DividendYield", "殖利率(%)", "殖利率"])),
          pb: num(pick(row, ["PBratio", "PBRatio", "股價淨值比"])),
        };
      });
      return map;
    },
  },
  {
    key: "revenue",
    label: "每月營業收入",
    path: "opendata/t187ap05_L",
    required: false,
    note: "月營收年增率——定期定額最該看的慢訊號。也是產業別的來源",
    normalize: function (rows) {
      var map = {};
      rows.forEach(function (row) {
        var code = normCode(pick(row, ["公司代號"]));
        /* 這份資料開頭有「出表日期」之類的雜訊列，用代號格式濾掉 */
        if (!/^\d{4}[A-Z]?$/.test(code)) return;
        map[code] = {
          month: rocMonth(pick(row, ["資料年月"])),
          industry: String(pick(row, ["產業別"]) || "").trim(),
          current: num(pick(row, ["營業收入-當月營收"])),
          lastMonth: num(pick(row, ["營業收入-上月營收"])),
          lastYear: num(pick(row, ["營業收入-去年當月營收"])),
          momPct: num(pick(row, ["營業收入-上月比較增減(%)"])),
          yoyPct: num(pick(row, ["營業收入-去年同月增減(%)"])),
          ytd: num(pick(row, ["累計營業收入-當月累計營收"])),
          ytdLastYear: num(pick(row, ["累計營業收入-去年累計營收"])),
          ytdPct: num(pick(row, ["累計營業收入-前期比較增減(%)"])),
        };
      });
      return map;
    },
  },
  {
    key: "institution",
    label: "三大法人買賣超",
    /* 這份資料不在 openapi.twse.com.tw 底下——它是證交所官網自己的報表 API
       （www.twse.com.tw/rwd/zh/fund/T86），回應也不是陣列，是
       {stat, date, fields, data}。抓取與轉換都在
       .github/workflows/stock-data.yml 裡用 jq 完成，轉出來的物件 key
       就是證交所自己回的欄位名稱。liveFallback:false——瀏覽器直連這裡
       用不上（不同網域、格式也不同），只能靠每日快照。 */
    path: "www.twse.com.tw/rwd/zh/fund/T86",
    liveFallback: false,
    required: false,
    note: "外資／投信當日動向",
    normalize: function (rows) {
      var map = {};
      rows.forEach(function (row) {
        var code = normCode(pick(row, ["證券代號", "Code"]));
        if (!code) return;
        map[code] = {
          /* 欄位名稱是第一次真正拿到證交所回應才確認的，列幾種可能的
             寫法保底——證交所的欄位命名不同報表常常不一致。 */
          foreign: num(
            pick(row, [
              "外資買賣超股數",
              "外陸資買賣超股數(不含外資自營商)",
              "外陸資買賣超股數",
              "外資及陸資買賣超股數",
            ])
          ),
          trust: num(pick(row, ["投信買賣超股數"])),
          dealer: num(
            pick(row, ["自營商買賣超股數", "自營商買賣超股數(自行買賣)"])
          ),
          total: num(pick(row, ["三大法人買賣超股數"])),
        };
      });
      return map;
    },
  },
];

/* ===== 抓資料 ===== */

/* 抓一個網址並解析成陣列。不 throw——呼叫端要的是「這個來源行不行」，
   不是例外處理。 */
async function tryJson(url) {
  try {
    var res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false, error: "HTTP " + res.status };
    var rows = await res.json();
    if (!Array.isArray(rows)) {
      return { ok: false, error: "回傳的不是陣列" };
    }
    return { ok: true, rows: rows };
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    /* fetch 被 CORS 擋掉時，瀏覽器基於安全考量只給籠統的 "Failed to fetch"，
       看不到真正的狀態碼。把最可能的原因寫出來，免得對著 TypeError 發呆。 */
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      msg += "（多半是 CORS 被擋，或沒有網路）";
    }
    return { ok: false, error: msg };
  }
}

/* 一個資料源：先試同源快照，失敗再退回直連證交所。 */
async function fetchSource(source) {
  var started = Date.now();

  var snap = await tryJson(SNAPSHOT_DIR + source.key + ".json");
  if (snap.ok) {
    var data = source.normalize(snap.rows);
    return {
      key: source.key,
      ok: true,
      via: "每日快照",
      data: data,
      count: Object.keys(data).length,
      ms: Date.now() - started,
    };
  }

  if (source.liveFallback === false) {
    return {
      key: source.key,
      ok: false,
      error: "快照：" + snap.error + "（這個來源不支援瀏覽器直連——不同網域、" +
        "格式也不同，只能等下一次每日快照）",
      ms: Date.now() - started,
    };
  }

  var live = await tryJson(apiUrl(source.path));
  if (live.ok) {
    var liveData = source.normalize(live.rows);
    return {
      key: source.key,
      ok: true,
      via: "直連證交所",
      data: liveData,
      count: Object.keys(liveData).length,
      ms: Date.now() - started,
    };
  }

  return {
    key: source.key,
    ok: false,
    error: "快照：" + snap.error + "／直連：" + live.error,
    ms: Date.now() - started,
  };
}

/* 快照的產生時間與各來源狀態（由工作流程寫入）。拿不到就算了。 */
async function fetchMeta() {
  try {
    var res = await fetch(SNAPSHOT_DIR + "meta.json");
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* 全市場本益比／殖利率中位數的歷史序列，每個交易日一筆，由
   .github/workflows/stock-data.yml 逐日累積寫入。已經是
   [{date, peMedian, yieldMedian, sampleSize}, ...]（按日期由舊到新排序）
   的乾淨格式，不需要再 normalize。拿不到就回傳空陣列，不當成致命錯誤——
   這是輔助資訊，沒有它其他功能照常運作。 */
async function fetchMarketHistory() {
  var result = await tryJson(SNAPSHOT_DIR + "market-history.json");
  return result.ok ? result.rows : [];
}

/* 定期定額交易戶數排行（ETFReport/ETFRank）：證交所自己統計「現在最多人
   真的在扣款什麼」，個股前十名、ETF 前十名並列，用實際戶數排序。

   這份資料形狀跟 SOURCES 裡其他來源不一樣——不是「代號 → 資料」的表，
   是固定的排行榜（第 1～10 名），所以不放進 SOURCES／loadAll() 那套
   map 導向的流程，獨立處理。回傳一個陣列，照名次排好序。 */
async function fetchEtfRank() {
  var result = await tryJson(SNAPSHOT_DIR + "etfRank.json");
  if (!result.ok) return [];

  return result.rows
    .map(function (row) {
      return {
        rank: num(pick(row, ["No"])),
        stockCode: normCode(pick(row, ["STOCKsSecurityCode"])),
        stockName: String(pick(row, ["STOCKsName"]) || "").trim(),
        stockAccounts: num(pick(row, ["STOCKsNumberofTradingAccounts"])),
        etfCode: normCode(pick(row, ["ETFsSecurityCode"])),
        etfName: String(pick(row, ["ETFsName"]) || "").trim(),
        etfAccounts: num(pick(row, ["ETFsNumberofTradingAccounts"])),
      };
    })
    .sort(function (a, b) {
      return (a.rank || 0) - (b.rank || 0);
    });
}

/* 全部資料源一起抓。回傳 { data, status, meta }。 */
async function loadAll() {
  var results = await Promise.all(SOURCES.map(fetchSource));
  var meta = await fetchMeta();

  var data = {};
  var status = results.map(function (result, i) {
    var source = SOURCES[i];
    if (result.ok) data[source.key] = result.data;
    return {
      key: source.key,
      label: source.label,
      path: source.path,
      note: source.note,
      required: source.required,
      ok: result.ok,
      via: result.via,
      error: result.error,
      count: result.count,
      ms: result.ms,
    };
  });

  return { data: data, status: status, meta: meta };
}

/* ===== 估值的相對位置 =====
   單看「殖利率 4%」沒有感覺，「贏過同業 82% 的股票」才讀得懂。

   有了月營收資料裡的「產業別」，就能做**同業**比較——這比全市場比較
   有意義得多，因為金融股和 IC 設計的合理本益比本來就不同。
   全市場的池子仍然保留，給沒有產業別的標的（例如 ETF）用。 */
function buildPercentiles(valuationMap, revenueMap) {
  var market = { pe: [], yield: [], pb: [] };
  var byIndustry = {};

  function add(pool, v) {
    /* 本益比 0 或負的代表虧損／沒有意義，排除掉才不會扭曲分布 */
    if (v.pe !== null && v.pe > 0) pool.pe.push(v.pe);
    if (v.yield !== null && v.yield > 0) pool.yield.push(v.yield);
    if (v.pb !== null && v.pb > 0) pool.pb.push(v.pb);
  }

  Object.keys(valuationMap || {}).forEach(function (code) {
    var v = valuationMap[code];
    add(market, v);

    var rev = (revenueMap || {})[code];
    var industry = rev && rev.industry;
    if (industry) {
      if (!byIndustry[industry]) byIndustry[industry] = { pe: [], yield: [], pb: [] };
      add(byIndustry[industry], v);
    }
  });

  function sortPool(pool) {
    Object.keys(pool).forEach(function (k) {
      pool[k].sort(function (a, b) {
        return a - b;
      });
    });
  }

  sortPool(market);
  Object.keys(byIndustry).forEach(function (k) {
    sortPool(byIndustry[k]);
  });

  return { market: market, byIndustry: byIndustry };
}

/* 用二分搜尋找出 value 在已排序陣列裡的百分位（0～100）。
   回傳「有多少 % 的股票小於或等於它」。 */
function percentile(sortedValues, value) {
  if (!sortedValues || !sortedValues.length || value === null) return null;

  var lo = 0;
  var hi = sortedValues.length;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (sortedValues[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / sortedValues.length) * 100);
}
