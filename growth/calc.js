/* 生長曲線百分位 — 計算核心

   目標是「和國健署健康九九⁺的新版兒童生長曲線算出一樣的結果」，所以每個
   細節都照政府網站的做法，而不是照教科書：
   1. 年齡：照抄政府網站前端 JS 的算法（歲、月、天用日曆相減，日數不足要借位）。
   2. 未滿 1857 天：WHO 2006 擴充版逐日 LMS。
      WHO 的逐日表正好到第 1856 天，所以分界是 1857，不是 5 歲整的 1826。
   3. 滿 1857 天：台灣 2010 表（陳偉德、張美惠），用「歲×12＋月」的月齡線性內插。
      這張表只有分界值、沒有 LMS，所以這段只能判斷區間。
   4. 數值剛好等於分界值時，歸到下面那一格（實測政府 API：66 個月男孩體重 22.9
      → 50 ~ 85）。
   驗證過程與實測數據見 .chat-context/WIP_生長曲線.md。

   這個檔案不碰畫面，瀏覽器和 node（測試）都能用。 */

var GROWTH_CUTS = [3, 15, 50, 85, 97];

/* 標準常態分布在 3／15／85／97 百分位的 Z 值 */
var GROWTH_Z = [-1.880793608151251, -1.0364333894937898, 0, 1.0364333894937898, 1.880793608151251];

var GROWTH_LAST_WHO_DAY = 1856;
var GROWTH_MAX_MONTHS = 84;

function createGrowthCalc(who, tw) {

  /* ===== 年齡 ===== */

  /* 日期一律用 {y, m, d}（m 是 1–12），避免 Date 的時區造成差一天 */
  function utcDays(date) {
    return Date.UTC(date.y, date.m - 1, date.d) / 86400000;
  }

  /* 照抄政府網站的算法：
       year = 年差；month = 月差；day = 日差
       day < 0 → month--，day 加上「測量日前一個月」的天數
       month < 0 → year--，month += 12
     日齡則是兩個日期直接相減的天數。 */
  function ageOf(birth, measure) {
    var year = measure.y - birth.y;
    var month = measure.m - birth.m;
    var day = measure.d - birth.d;
    if (day < 0) {
      month--;
      // Date.UTC(年, 月(0 起算), 0) 是「上個月的最後一天」
      day += new Date(Date.UTC(measure.y, measure.m - 1, 0)).getUTCDate();
    }
    if (month < 0) {
      year--;
      month += 12;
    }
    return {
      years: year,
      months: month,
      days: day,
      totalDays: utcDays(measure) - utcDays(birth),
      totalMonths: year * 12 + month,
    };
  }

  /* ===== 分界值 ===== */

  /* WHO：用 LMS 反推各百分位的量測值 */
  function whoCuts(kind, sex, day) {
    var t = who[kind][sex];
    var L = t.L[day], M = t.M[day], S = t.S[day];
    return GROWTH_Z.map(function (z) {
      return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
    });
  }

  /* 台灣表：依月齡在半歲的資料點之間線性內插 */
  function twCuts(kind, sex, totalMonths) {
    var t = tw[sex];
    var age = totalMonths / 12;
    var ages = t.ages;
    if (age <= ages[0]) return t[kind][0].slice();
    for (var i = 1; i < ages.length; i++) {
      if (age <= ages[i]) {
        var f = (age - ages[i - 1]) / (ages[i] - ages[i - 1]);
        var lo = t[kind][i - 1], hi = t[kind][i];
        return lo.map(function (v, k) { return v + (hi[k] - v) * f; });
      }
    }
    return null;
  }

  /* 數值超過幾條分界線 → 落在哪一格。剛好等於分界值算下面那一格。 */
  function bandOf(value, cuts) {
    var above = 0;
    for (var i = 0; i < cuts.length; i++) {
      if (value > cuts[i]) above = i + 1;
    }
    if (above === 0) return "<" + GROWTH_CUTS[0];
    if (above === cuts.length) return ">" + GROWTH_CUTS[cuts.length - 1];
    return GROWTH_CUTS[above - 1] + " ~ " + GROWTH_CUTS[above];
  }

  /* ===== 對外 ===== */

  /* 回傳 { cuts, standard } 或 { error }
     kind：'height' | 'weight'；sex：1 男、2 女 */
  function cutsFor(kind, sex, age) {
    if (age.totalDays < 0) return { error: "生日晚於測量日" };
    // 政府網站：未滿 1857 天用日齡（WHO），之後用月齡（台灣表）
    if (age.totalDays <= GROWTH_LAST_WHO_DAY) {
      return { cuts: whoCuts(kind, sex, age.totalDays), standard: "WHO" };
    }
    // 政府網站的前端擋「滿 8 歲」，但台灣表只到 7 歲（84 個月），
    // 85 個月以上 API 回「查無對應生長曲線資料」
    if (age.totalMonths > GROWTH_MAX_MONTHS) return { error: "超出範圍" };
    return { cuts: twCuts(kind, sex, age.totalMonths), standard: "TW" };
  }

  function classify(kind, sex, age, value) {
    var r = cutsFor(kind, sex, age);
    if (r.error) return r;
    return { band: bandOf(value, r.cuts), standard: r.standard };
  }

  return {
    ageOf: ageOf,
    whoCuts: whoCuts,
    twCuts: twCuts,
    bandOf: bandOf,
    cutsFor: cutsFor,
    classify: classify,
  };
}

if (typeof module !== "undefined") module.exports = createGrowthCalc;
