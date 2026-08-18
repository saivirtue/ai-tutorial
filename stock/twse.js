/* 台股資料層：只用證券交易所官方 OpenAPI
   —— 免金鑰、免註冊、免後端，所以可以直接放在 GitHub Pages 上。

   ⚠️ 重要限制：這裡拿到的全部是「收盤後的日頻資料」，不是盤中即時報價。
   官方免費且免金鑰的來源就只有這種。想要盤中跳動的報價，一定得自己養一個
   proxy 或買付費 API——那是另一個等級的工程，這個頁面刻意不做。

   最外層變數用 var，跟專案其他檔案一致（見 shared/game-utils.js 的說明）。 */

var TWSE_BASE = "https://openapi.twse.com.tw/v1/";

/* ===== CORS 備援 =====
   證交所的 OpenAPI 有沒有對瀏覽器開放跨域，會隨他們的設定變動。萬一被擋，
   使用者可以在頁面上填一個 proxy 前綴（例如自己架的 Cloudflare Worker），
   不用改程式碼。填法兩種都支援：
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

/* 證交所回傳的數字都是字串，而且會有千分位逗號、缺值用 "--"。
   一律轉成數字或 null，後面畫面才不用到處判斷。 */
function num(value) {
  if (value === null || value === undefined) return null;
  var s = String(value).replace(/,/g, "").trim();
  if (s === "" || s === "--" || s === "-" || s === "N/A") return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

/* 證交所各個 API 的欄位名稱不一致（有的叫 Code、有的叫「公司代號」），
   而且他們偶爾會改。給一串候選名稱，挑第一個存在的。 */
function pick(row, names) {
  for (var i = 0; i < names.length; i++) {
    if (row[names[i]] !== undefined && row[names[i]] !== null) {
      return row[names[i]];
    }
  }
  return undefined;
}

/* 代號正規化：有些 API 會回傳前後空白 */
function normCode(value) {
  return String(value === undefined ? "" : value).trim();
}

/* ===== 資料源定義 =====
   每一個都獨立抓、獨立失敗。其中一個掛掉不會拖垮整頁——畫面上那張卡片
   會顯示「沒資料」，而且下方的「資料源狀態」會告訴你是哪個、為什麼。

   required: true 的抓不到，整頁就沒東西可看；false 的只是少一塊資訊。 */
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
          yieldYear: pick(row, ["YieldYear", "財報年/季", "股利年度"]),
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
    note: "月營收年增率——定期定額最該看的慢訊號",
    normalize: function (rows) {
      var map = {};
      rows.forEach(function (row) {
        var code = normCode(pick(row, ["公司代號", "Code", "出表日期"]));
        if (!code || !/^\d{4}$/.test(code)) return;
        map[code] = {
          month: pick(row, ["資料年月", "年月"]),
          current: num(pick(row, ["營業收入-當月營收", "當月營收"])),
          lastMonth: num(pick(row, ["營業收入-上月營收", "上月營收"])),
          lastYear: num(pick(row, ["營業收入-去年當月營收", "去年當月營收"])),
          momPct: num(pick(row, ["營業收入-上月比較增減(%)", "上月比較增減(%)"])),
          yoyPct: num(pick(row, ["營業收入-去年同月增減(%)", "去年同月增減(%)"])),
        };
      });
      return map;
    },
  },
  {
    key: "institution",
    label: "三大法人買賣超",
    path: "fund/T86",
    required: false,
    note: "外資／投信當日動向",
    normalize: function (rows) {
      var map = {};
      rows.forEach(function (row) {
        var code = normCode(pick(row, ["證券代號", "Code"]));
        if (!code) return;
        map[code] = {
          foreign: num(
            pick(row, [
              "外陸資買賣超股數(不含外資自營商)",
              "外資買賣超股數",
              "外陸資買賣超股數",
            ])
          ),
          trust: num(pick(row, ["投信買賣超股數"])),
          dealer: num(pick(row, ["自營商買賣超股數"])),
          total: num(pick(row, ["三大法人買賣超股數"])),
        };
      });
      return map;
    },
  },
];

/* ===== 抓資料 ===== */

/* 抓一個資料源。回傳 { key, ok, data, error, count }——不會 throw，
   因為我們要的是「這個掛了但其他還在」，不是整頁死掉。 */
async function fetchSource(source) {
  var started = Date.now();
  try {
    var res = await fetch(apiUrl(source.path), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        key: source.key,
        ok: false,
        error: "HTTP " + res.status + " " + res.statusText,
        ms: Date.now() - started,
      };
    }
    var rows = await res.json();
    if (!Array.isArray(rows)) {
      return {
        key: source.key,
        ok: false,
        error: "回傳的不是陣列（可能被 proxy 或錯誤頁包住了）",
        ms: Date.now() - started,
      };
    }
    var data = source.normalize(rows);
    return {
      key: source.key,
      ok: true,
      data: data,
      count: Object.keys(data).length,
      rawCount: rows.length,
      ms: Date.now() - started,
    };
  } catch (err) {
    /* fetch 被 CORS 擋掉時，瀏覽器基於安全考量只給一個很籠統的
       "Failed to fetch"，看不到真正的狀態碼。這裡把最可能的原因寫出來，
       免得使用者對著一句 TypeError 發呆。 */
    var msg = err && err.message ? err.message : String(err);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      msg += "（多半是 CORS 被擋，或沒有網路。可以試著在下面設定 proxy）";
    }
    return { key: source.key, ok: false, error: msg, ms: Date.now() - started };
  }
}

/* 全部資料源一起抓。回傳 { data, status }。 */
async function loadAll() {
  var results = await Promise.all(SOURCES.map(fetchSource));

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
      error: result.error,
      count: result.count,
      ms: result.ms,
    };
  });

  return { data: data, status: status };
}

/* ===== 全市場統計 =====
   手上既然有全市場的估值資料，就可以算「這檔的殖利率在全市場排第幾」。
   單看「殖利率 4%」沒有感覺，「贏過全市場 82% 的股票」才有。

   注意：這是**跨產業**的比較，金融股和 IC 設計的合理本益比本來就不同，
   所以這個數字是粗略的參考，不是估值結論。 */
function buildPercentiles(valuationMap) {
  var pool = { pe: [], yield: [], pb: [] };

  Object.keys(valuationMap || {}).forEach(function (code) {
    var v = valuationMap[code];
    /* 本益比 0 或負的代表虧損／沒有意義，排除掉才不會扭曲分布 */
    if (v.pe !== null && v.pe > 0) pool.pe.push(v.pe);
    if (v.yield !== null && v.yield > 0) pool.yield.push(v.yield);
    if (v.pb !== null && v.pb > 0) pool.pb.push(v.pb);
  });

  Object.keys(pool).forEach(function (k) {
    pool[k].sort(function (a, b) {
      return a - b;
    });
  });

  return pool;
}

/* 用二分搜尋找出 value 在已排序陣列裡的百分位（0～100）。
   回傳「有多少 % 的股票比它小」。 */
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
