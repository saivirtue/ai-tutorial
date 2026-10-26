/* 生長曲線百分位 — 讀寫 Excel

   寫回的做法是「只改兩欄」：用 JSZip 打開 xlsx，只把結果寫進兩個「生長曲線」
   欄的儲存格，其他所有內容（合併儲存格、字型、框線、欄寬、其他工作表）原封
   不動。整份讀進來再寫出去的程式庫（例如 SheetJS 免費版）會把格式弄丟。

   預期的版面（和舊的 Colab notebook 一樣）：
     第 1 列：班級名稱、學期
     第 2 列：A 欄「測量時間」，後面某一格是測量日期
     第 3 列：學生姓名｜出生年月日｜性別｜年齡｜身高｜生長曲線｜體重｜生長曲線
     第 4 列起：學生資料
   欄位是用第 3 列的表頭文字找的，不寫死在哪一欄。

   這個檔案不碰畫面，瀏覽器和 node（測試）都能用。 */

/* ===== 小工具 ===== */

function xmlUnescape(s) {
  return s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-fA-F]+|#\d+);/g, function (_, e) {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    if (e === "amp") return "&";
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* <si> 或 <is> 裡的文字：可能分成好幾段 <r><t>，也可能帶注音／拼音標註 <rPh>（要去掉） */
function richText(xml) {
  xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  var out = "";
  xml.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (_, t) { out += t; });
  return xmlUnescape(out);
}

function colIndex(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

function colLetters(n) {
  var s = "";
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - 1 - r) / 26;
  }
  return s;
}

function splitRef(ref) {
  var m = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: m[1], row: parseInt(m[2], 10) };
}

/* 相對路徑（例 "worksheets/sheet1.xml" 或 "/xl/worksheets/sheet1.xml"）→ zip 內的路徑 */
function resolveTarget(target) {
  if (target[0] === "/") return target.slice(1);
  return "xl/" + target;
}

/* ===== 日期與數值 ===== */

/* Excel 日期序號 → {y, m, d}（1900 日期系統） */
function serialToDate(serial) {
  var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function validDate(y, m, d) {
  var t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/* 儲存格 → {y, m, d} 或 null。
   接受：Excel 日期序號、民國年文字（111/05/03）、西元年文字（2022/05/03 或 2022-05-03）。 */
function parseDateCell(cell) {
  if (!cell || cell.text === "") return null;
  if (cell.isNumber) {
    var n = parseFloat(cell.text);
    // 合理的日期序號範圍：1950–2100 年
    return n > 18000 && n < 73000 ? serialToDate(n) : null;
  }
  var m = /^\s*(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?\s*$/.exec(cell.text);
  if (!m) return null;
  var y = parseInt(m[1], 10);
  if (y < 1000) y += 1911; // 民國年
  var date = { y: y, m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
  return validDate(date.y, date.m, date.d) ? date : null;
}

/* 身高、體重常常存成「文字格式的數字」，這裡一律轉成數字；不是數字就回 null */
function parseNumberCell(cell) {
  if (!cell) return null;
  var t = cell.text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return parseFloat(t);
}

function parseSex(cell) {
  if (!cell) return null;
  var t = cell.text.trim();
  if (t[0] === "男") return 1;
  if (t[0] === "女") return 2;
  return null;
}

/* ===== 讀取 ===== */

function parseSharedStrings(xml) {
  var out = [];
  if (!xml) return out;
  xml.replace(/<si>([\s\S]*?)<\/si>|<si\/>/g, function (_, body) { out.push(body ? richText(body) : ""); });
  return out;
}

/* 工作表 XML → { "A1": {text, isNumber}, … } */
function parseCells(xml, shared) {
  var cells = {};
  var re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  var m;
  while ((m = re.exec(xml))) {
    var attrs = m[1], body = m[2] || "";
    var ref = /\br="([A-Z]+\d+)"/.exec(attrs);
    if (!ref) continue;
    var type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
    var v = /<v>([\s\S]*?)<\/v>/.exec(body);
    var text;
    if (type === "s") text = v ? shared[parseInt(v[1], 10)] || "" : "";
    else if (type === "inlineStr") text = richText((/<is>([\s\S]*?)<\/is>/.exec(body) || ["", ""])[1]);
    else text = v ? xmlUnescape(v[1]) : "";
    cells[ref[1]] = { text: text, isNumber: !type || type === "n" };
  }
  return cells;
}

/* 用表頭文字找欄位。兩個「生長曲線」欄：分別是身高、體重右邊第一個「生長曲線」。 */
function findColumns(cells, headerRow) {
  var headers = [];
  Object.keys(cells).forEach(function (ref) {
    var p = splitRef(ref);
    if (p.row === headerRow) headers.push({ col: colIndex(p.col), text: cells[ref].text.replace(/\s/g, "") });
  });
  headers.sort(function (a, b) { return a.col - b.col; });
  function find(test, after) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].col > (after || 0) && test(headers[i].text)) return headers[i].col;
    }
    return null;
  }
  var cols = {
    name: find(function (t) { return t.indexOf("姓名") >= 0; }),
    birth: find(function (t) { return t.indexOf("出生") >= 0 || t.indexOf("生日") >= 0; }),
    sex: find(function (t) { return t.indexOf("性別") >= 0; }),
    height: find(function (t) { return t.indexOf("身高") >= 0 || t.indexOf("身長") >= 0; }),
    weight: find(function (t) { return t.indexOf("體重") >= 0; }),
  };
  function isCurve(t) { return t.indexOf("生長曲線") >= 0 || t.indexOf("百分位") >= 0; }
  cols.heightOut = cols.height && find(isCurve, cols.height);
  cols.weightOut = cols.weight && find(isCurve, cols.weight);
  return cols;
}

var COLUMN_LABELS = {
  name: "學生姓名", birth: "出生年月日", sex: "性別", height: "身高", weight: "體重",
  heightOut: "身高右邊的「生長曲線」", weightOut: "體重右邊的「生長曲線」",
};

/* 找表頭列：前 10 列裡同時有「身高」和「體重」的那一列 */
function findHeaderRow(cells) {
  for (var r = 1; r <= 10; r++) {
    var texts = Object.keys(cells).filter(function (ref) { return splitRef(ref).row === r; })
      .map(function (ref) { return cells[ref].text; }).join("|");
    if (texts.indexOf("身高") >= 0 && texts.indexOf("體重") >= 0) return r;
  }
  return null;
}

/* 測量日：表頭列以上，第一個能解析成日期的儲存格 */
function findMeasureDate(cells, headerRow) {
  var refs = Object.keys(cells).filter(function (ref) { return splitRef(ref).row < headerRow; });
  refs.sort(function (a, b) {
    var pa = splitRef(a), pb = splitRef(b);
    return pa.row - pb.row || colIndex(pa.col) - colIndex(pb.col);
  });
  for (var i = 0; i < refs.length; i++) {
    var d = parseDateCell(cells[refs[i]]);
    if (d) return { date: d, ref: refs[i] };
  }
  return null;
}

/* 讀進整個活頁簿。回傳 { zip, sheets: [{ name, path, xml, cells, problem?, headerRow, cols, measure, rows }] } */
function readWorkbook(JSZip, data) {
  return JSZip.loadAsync(data).then(function (zip) {
    var need = ["xl/workbook.xml", "xl/_rels/workbook.xml.rels"];
    for (var i = 0; i < need.length; i++) {
      if (!zip.file(need[i])) throw new Error("這不是 Excel 的 .xlsx 檔（找不到 " + need[i] + "）");
    }
    var sst = zip.file("xl/sharedStrings.xml");
    return Promise.all([
      zip.file("xl/workbook.xml").async("string"),
      zip.file("xl/_rels/workbook.xml.rels").async("string"),
      sst ? sst.async("string") : Promise.resolve(""),
    ]).then(function (texts) {
      var shared = parseSharedStrings(texts[2]);
      var rels = {};
      texts[1].replace(/<Relationship\b([^>]*)\/?>/g, function (_, a) {
        var id = /\bId="([^"]+)"/.exec(a), target = /\bTarget="([^"]+)"/.exec(a);
        if (id && target) rels[id[1]] = target[1];
      });
      var sheetDefs = [];
      texts[0].replace(/<sheet\b([^>]*)\/?>/g, function (_, a) {
        var name = /\bname="([^"]*)"/.exec(a), rid = /\br:id="([^"]+)"/.exec(a);
        if (name && rid && rels[rid[1]]) sheetDefs.push({ name: xmlUnescape(name[1]), path: resolveTarget(rels[rid[1]]) });
      });
      return Promise.all(sheetDefs.map(function (def) {
        var f = zip.file(def.path);
        return f ? f.async("string").then(function (xml) { return analyzeSheet(def, xml, shared); }) : null;
      })).then(function (sheets) {
        return { zip: zip, sheets: sheets.filter(Boolean) };
      });
    });
  });
}

function analyzeSheet(def, xml, shared) {
  var sheet = { name: def.name, path: def.path, xml: xml, rows: [] };
  var cells = parseCells(xml, shared);
  var headerRow = findHeaderRow(cells);
  if (!headerRow) {
    sheet.problem = "找不到有「身高」和「體重」的表頭列，略過這個工作表";
    return sheet;
  }
  var cols = findColumns(cells, headerRow);
  var missing = Object.keys(COLUMN_LABELS).filter(function (k) { return !cols[k]; });
  if (missing.length) {
    sheet.problem = "第 " + headerRow + " 列找不到這些欄位：" +
      missing.map(function (k) { return COLUMN_LABELS[k]; }).join("、");
    return sheet;
  }
  var measure = findMeasureDate(cells, headerRow);
  if (!measure) {
    sheet.problem = "表頭上方找不到測量日期";
    return sheet;
  }
  sheet.headerRow = headerRow;
  sheet.cols = cols;
  sheet.measure = measure.date;

  var lastRow = 0;
  Object.keys(cells).forEach(function (ref) {
    var p = splitRef(ref);
    if (p.row > lastRow && cells[ref].text.trim() !== "") lastRow = p.row;
  });
  function cell(col, row) { return cells[colLetters(col) + row]; }
  for (var r = headerRow + 1; r <= lastRow; r++) {
    var raw = {
      name: cell(cols.name, r), birth: cell(cols.birth, r), sex: cell(cols.sex, r),
      height: cell(cols.height, r), weight: cell(cols.weight, r),
    };
    // 整列輸入欄位都是空的 → 不是學生資料
    var empty = Object.keys(raw).every(function (k) { return !raw[k] || raw[k].text.trim() === ""; });
    if (empty) continue;
    sheet.rows.push({
      row: r,
      name: raw.name ? raw.name.text.trim() : "",
      raw: raw,
      birth: parseDateCell(raw.birth),
      sex: parseSex(raw.sex),
      height: parseNumberCell(raw.height),
      weight: parseNumberCell(raw.weight),
    });
  }
  return sheet;
}

/* ===== 寫回 ===== */

/* 把一個儲存格設成文字（inline string）。保留原本的樣式（s 屬性）；
   儲存格或整列不存在時依欄／列順序插入。 */
function setCellText(xml, ref, text) {
  var p = splitRef(ref);
  var col = colIndex(p.col);
  var newCell = function (style) {
    return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : "") + ' t="inlineStr"><is><t>' +
      xmlEscape(text) + "</t></is></c>";
  };

  var rowRe = new RegExp('<row\\b[^>]*\\br="' + p.row + '"[^>]*?(?:/>|>[\\s\\S]*?</row>)');
  var rowMatch = rowRe.exec(xml);
  if (!rowMatch) return insertRow(xml, p.row, "<row r=\"" + p.row + "\">" + newCell(null) + "</row>");

  var rowXml = rowMatch[0];
  var cellRe = new RegExp('<c\\b[^>]*\\br="' + ref + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)');
  var cellMatch = cellRe.exec(rowXml);
  var newRowXml;
  if (cellMatch) {
    var style = (/\bs="(\d+)"/.exec(cellMatch[0].slice(0, cellMatch[0].indexOf(">"))) || [])[1];
    newRowXml = rowXml.replace(cellMatch[0], function () { return newCell(style); });
  } else {
    if (/\/>$/.test(rowXml) && rowXml.indexOf("</row>") < 0) {
      // 空的自我結束列 <row r="5" … />
      newRowXml = rowXml.replace(/\s*\/>$/, ">") + newCell(null) + "</row>";
    } else {
      // 插在第一個欄位比它大的儲存格前面
      var inserted = false;
      newRowXml = rowXml.replace(/<c\b[^>]*\br="([A-Z]+)\d+"/g, function (all, letters) {
        if (!inserted && colIndex(letters) > col) {
          inserted = true;
          return newCell(null) + all;
        }
        return all;
      });
      if (!inserted) newRowXml = newRowXml.replace(/<\/row>$/, function () { return newCell(null) + "</row>"; });
    }
  }
  return xml.slice(0, rowMatch.index) + newRowXml + xml.slice(rowMatch.index + rowXml.length);
}

function insertRow(xml, rowNum, rowXml) {
  var done = false;
  var out = xml.replace(/<row\b[^>]*\br="(\d+)"/g, function (all, n) {
    if (!done && parseInt(n, 10) > rowNum) {
      done = true;
      return rowXml + all;
    }
    return all;
  });
  if (done) return out;
  if (/<sheetData\s*\/>/.test(out)) return out.replace(/<sheetData\s*\/>/, "<sheetData>" + rowXml + "</sheetData>");
  return out.replace("</sheetData>", rowXml + "</sheetData>");
}

/* results：[{ sheet, ref, text }]。回傳新的 zip（呼叫端自己 generateAsync）。 */
function writeResults(workbook, results) {
  var bySheet = {};
  results.forEach(function (r) {
    (bySheet[r.sheet.path] = bySheet[r.sheet.path] || { sheet: r.sheet, items: [] }).items.push(r);
  });
  Object.keys(bySheet).forEach(function (path) {
    var xml = bySheet[path].sheet.xml;
    bySheet[path].items.forEach(function (r) { xml = setCellText(xml, r.ref, r.text); });
    workbook.zip.file(path, xml);
  });
  return workbook.zip;
}

var GrowthXlsx = {
  readWorkbook: readWorkbook,
  writeResults: writeResults,
  setCellText: setCellText,
  parseDateCell: parseDateCell,
  colLetters: colLetters,
};

if (typeof module !== "undefined") module.exports = GrowthXlsx;
