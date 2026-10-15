/* 生長曲線百分位 — 把讀到的學生資料算成要寫回 Excel 的結果

   規則（和舊的 Colab notebook 一致，再補上錯誤提示）：
   - 生日、性別、身高、體重有任何一格是空的 → 兩欄都留白（舊 notebook 也是這樣）
   - 格式看不懂 → 填「格式錯誤」，畫面上列出是哪一列、哪一欄
   - 超過 84 個月 → 填「超出範圍」（政府網站也查不到） */

function processWorkbook(calc, xlsx, workbook) {
  var results = [];   // [{ sheet, ref, text }]：要寫回的儲存格
  var report = [];    // 給畫面顯示的每一列摘要

  workbook.sheets.forEach(function (sheet) {
    if (sheet.problem) return;
    var cols = sheet.cols;
    var hRef = function (r) { return xlsx.colLetters(cols.heightOut) + r; };
    var wRef = function (r) { return xlsx.colLetters(cols.weightOut) + r; };

    sheet.rows.forEach(function (row) {
      var item = { sheet: sheet.name, row: row.row, name: row.name, issues: [] };
      report.push(item);

      var blank = ["birth", "sex", "height", "weight"].filter(function (k) {
        return !row.raw[k] || row.raw[k].text.trim() === "";
      });
      if (blank.length) {
        item.issues.push("資料不完整，留白");
        return;
      }

      var heightText, weightText;
      if (!row.birth) item.issues.push("出生年月日看不懂");
      if (!row.sex) item.issues.push("性別要填「男」或「女」");
      if (row.height === null) item.issues.push("身高不是數字");
      if (row.weight === null) item.issues.push("體重不是數字");

      if (!row.birth || !row.sex) {
        heightText = weightText = "格式錯誤";
      } else {
        var age = calc.ageOf(row.birth, sheet.measure);
        item.age = age;
        var h = row.height === null ? { band: "格式錯誤" } : calc.classify("height", row.sex, age, row.height);
        var w = row.weight === null ? { band: "格式錯誤" } : calc.classify("weight", row.sex, age, row.weight);
        if (h.error || w.error) {
          var err = h.error || w.error;
          item.issues.push(err === "超出範圍" ? "超過 7 歲（84 個月），沒有可用的標準" : err);
          heightText = weightText = err === "超出範圍" ? "超出範圍" : "日期錯誤";
        } else {
          heightText = h.band;
          weightText = w.band;
          item.standard = h.standard || w.standard;
        }
      }
      item.height = heightText;
      item.weight = weightText;
      results.push({ sheet: sheet, ref: hRef(row.row), text: heightText });
      results.push({ sheet: sheet, ref: wRef(row.row), text: weightText });
    });
  });

  return { results: results, report: report };
}

if (typeof module !== "undefined") module.exports = processWorkbook;
