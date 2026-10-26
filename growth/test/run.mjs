/* 生長曲線百分位 — 測試
   執行：node growth/test/run.mjs

   測試資料全部是合成的。真實的班級 Excel 不要放進 repo（repo 是公開的）。 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const JSZip = require("../vendor/jszip.min.js");
const createGrowthCalc = require("../calc.js");
const GrowthXlsx = require("../xlsx-io.js");
const processWorkbook = require("../process.js");
const calc = createGrowthCalc(require("../data/who-lms.js"), require("../data/tw2010.js"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

/* ===== 1. 和政府 API 的實測結果比對 ===== */

for (const c of json("./api-vectors.json").cases) {
  await test(`API 實測：${c.note}｜${c.mode === "day" ? "第" + c.age + "天" : c.age + "個月"} ${c.kind} ${c.value}`, () => {
    // 月齡模式的案例一定已滿 1857 天，日齡給一個夠大的數字就好
    const age = c.mode === "day" ? { totalDays: c.age, totalMonths: 0 } : { totalDays: 9999, totalMonths: c.age };
    assert.equal(calc.classify(c.kind, c.sex, age, c.value).band, c.expect);
  });
}

/* ===== 2. WHO：LMS 算出的分界值要和 WHO 自己公布的百分位一致 ===== */

const whoCheck = json("./who-check.json");
for (const key of Object.keys(whoCheck).filter((k) => !k.startsWith("_"))) {
  const [kind, sex] = key.split("-");
  for (const [day, published] of Object.entries(whoCheck[key])) {
    await test(`WHO 分界值：${kind} 性別${sex} 第${day}天`, () => {
      const cuts = calc.whoCuts(kind, Number(sex), Number(day));
      // WHO 公布的值四捨五入到小數第 3 位
      cuts.forEach((v, i) => assert.ok(Math.abs(v - published[i]) < 0.0006, `P${[3, 15, 50, 85, 97][i]}：算出 ${v}，WHO 公布 ${published[i]}`));
    });
  }
}

/* ===== 3. 台灣表的內插 ===== */

const tw = require("../data/tw2010.js");
await test("台灣表：半歲的資料點要剛好等於原表", () => {
  for (const sex of [1, 2]) {
    tw[sex].ages.forEach((a, i) => {
      assert.deepEqual(calc.twCuts("weight", sex, a * 12).map((v) => +v.toFixed(6)), tw[sex].weight[i]);
      assert.deepEqual(calc.twCuts("height", sex, a * 12).map((v) => +v.toFixed(6)), tw[sex].height[i]);
    });
  }
});
await test("台灣表：63 個月是 5 歲和 5.5 歲的中點", () => {
  const mid = calc.twCuts("weight", 1, 63);
  tw[1].weight[0].forEach((v, i) => assert.ok(Math.abs(mid[i] - (v + tw[1].weight[1][i]) / 2) < 1e-9));
});

/* ===== 4. 年齡（照抄政府網站前端的算法） ===== */

const D = (s) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
const dayDiff = (a, b) => (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000;
const ageCases = [
  // [生日, 測量日, 歲, 月, 天]
  ["2022-05-03", "2026-03-05", 3, 10, 2],
  ["2021-03-31", "2026-03-05", 4, 11, 2],    // 日數借位：借 2 月（28 天）
  ["2020-02-29", "2025-02-28", 4, 11, 30],   // 閏日出生
  ["2020-02-29", "2024-02-29", 4, 0, 0],
  ["2021-01-31", "2021-03-01", 0, 1, -2],    // 政府網站只借位一次，天數會是負的；月齡（1）不受影響，照抄
  ["2021-03-05", "2026-03-05", 5, 0, 0],
];
for (const [b, m, y, mo, d] of ageCases) {
  await test(`年齡：${b} → ${m}`, () => {
    const age = calc.ageOf(D(b), D(m));
    assert.deepEqual([age.years, age.months, age.days], [y, mo, d]);
    assert.equal(age.totalMonths, y * 12 + mo);
    assert.equal(age.totalDays, dayDiff(D(b), D(m)));
  });
}

/* ===== 5. 標準的切換與範圍 ===== */

await test("第 1856 天用 WHO、第 1857 天改用台灣表", () => {
  assert.equal(calc.cutsFor("weight", 1, { totalDays: 1856, totalMonths: 61 }).standard, "WHO");
  assert.equal(calc.cutsFor("weight", 1, { totalDays: 1857, totalMonths: 61 }).standard, "TW");
});
await test("84 個月可以算、85 個月超出範圍", () => {
  assert.equal(calc.cutsFor("weight", 1, { totalDays: 2560, totalMonths: 84 }).standard, "TW");
  assert.equal(calc.cutsFor("weight", 1, { totalDays: 2590, totalMonths: 85 }).error, "超出範圍");
});
await test("生日晚於測量日", () => {
  assert.ok(calc.cutsFor("weight", 1, { totalDays: -1, totalMonths: 0 }).error);
});
await test("區間的寫法", () => {
  const cuts = [1, 2, 3, 4, 5];
  assert.deepEqual([0.5, 1, 1.5, 2.5, 3.5, 4.5, 5, 5.5].map((v) => calc.bandOf(v, cuts)),
    ["<3", "<3", "3 ~ 15", "15 ~ 50", "50 ~ 85", "85 ~ 97", "85 ~ 97", ">97"]);
});

/* ===== 6. Excel：讀取、計算、只改兩欄 ===== */

/* 合成的活頁簿，版面照真實的班級檔案（見 WIP 事實七）：
   第 1–2 列合併儲存格、D2 是日期格式、第 3 列表頭、身高體重存成文字、
   F／H 欄是空白但有樣式的儲存格、後面還有一堆空白列。
   第二個工作表故意做成：結果欄的儲存格不存在、有自我結束的空白列、有各種錯誤資料。 */
const SST = [];
const s = (text) => { let i = SST.indexOf(text); if (i < 0) { SST.push(text); i = SST.length - 1; } return i; };
const strCell = (ref, text, style = 1) => `<c r="${ref}" s="${style}" t="s"><v>${s(text)}</v></c>`;
const HEAD = ["學生姓名", "出生年月日", "性別", "年齡", "身高", "生長曲線", "體重", "生長曲線"];

function sheetXml(className, students, { withOutCells }) {
  const rows = [
    `<row r="1">${strCell("A1", className, 0)}${strCell("D1", "114第二學期", 0)}</row>`,
    `<row r="2">${strCell("A2", "測量時間", 0)}<c r="D2" s="2"><v>46086</v></c></row>`, // 2026-03-05
    `<row r="3">${HEAD.map((h, i) => strCell(String.fromCharCode(65 + i) + 3, h)).join("")}</row>`,
  ];
  students.forEach((st, i) => {
    const r = 4 + i;
    if (st === null) { rows.push(`<row r="${r}" spans="1:8"/>`); return; }
    const [name, birth, sex, age, h, w] = st;
    const cells = [
      name !== "" && strCell(`A${r}`, name), birth !== "" && strCell(`B${r}`, birth), sex !== "" && strCell(`C${r}`, sex),
      age !== "" && strCell(`D${r}`, age, 0), h !== "" && strCell(`E${r}`, h),
      withOutCells && `<c r="F${r}" s="1"/>`, w !== "" && strCell(`G${r}`, w), withOutCells && `<c r="H${r}" s="1"/>`,
    ].filter(Boolean).join("");
    rows.push(`<row r="${r}">${cells}</row>`);
  });
  for (let r = 4 + students.length; r < 4 + students.length + 5; r++) {
    rows.push(`<row r="${r}"><c r="A${r}" s="1"/><c r="E${r}" s="1"/></row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:H999"/><sheetData>${rows.join("")}</sheetData><mergeCells count="4"><mergeCell ref="A1:C1"/><mergeCell ref="D1:H1"/><mergeCell ref="A2:C2"/><mergeCell ref="D2:H2"/></mergeCells></worksheet>`;
}

async function makeWorkbook() {
  const sheet1 = sheetXml("小班", [
    ["王小明", "111/05/03", "男", "3歲10月", "98", "15.5"],   // 1402 天
    ["林小美", "112/01/20", "女", "3歲1月", "95.2", "14"],    // 1140 天
  ], { withOutCells: true });
  const sheet2 = sheetXml("大班", [
    ["陳大華", "109/09/10", "男", "5歲5月", "112", "22.9"],   // 2002 天、65 個月 → 台灣表
    ["李缺資料", "109/10/01", "女", "", "110", ""],           // 缺體重 → 留白
    null,                                                     // 自我結束的空白列
    ["張生日錯", "109/13/01", "女", "", "110", "20"],          // 沒有 13 月
    ["趙文字", "110/02/02", "男", "", "一百", "20"],           // 身高不是數字
    ["周太大", "107/01/01", "女", "", "130", "28"],            // 98 個月 → 超出範圍
  ], { withOutCells: false });
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="小班" sheetId="1" r:id="rId1"/><sheet name="大班" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="12"/><name val="新細明體"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml", sheet1);
  zip.file("xl/worksheets/sheet2.xml", sheet2);
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${SST.length}" uniqueCount="${SST.length}">${SST.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

const input = await makeWorkbook();
// node growth/test/run.mjs --write-fixture <路徑>：把合成的活頁簿存成檔案，給瀏覽器手動測試用
const fixtureArg = process.argv.indexOf("--write-fixture");
if (fixtureArg > 0) writeFileSync(process.argv[fixtureArg + 1], input);
const wb =await GrowthXlsx.readWorkbook(JSZip, input);
const { results, report } = processWorkbook(calc, GrowthXlsx, wb);
const out = await (await GrowthXlsx.writeResults(wb, results)).generateAsync({ type: "nodebuffer" });
const outZip = await JSZip.loadAsync(out);
const inZip = await JSZip.loadAsync(input);
const outBook = await GrowthXlsx.readWorkbook(JSZip, out);
const cellText = (sheetIdx, ref) => {
  const xml = outBook.sheets[sheetIdx].xml;
  const m = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml);
  return m ? (/<t>([^<]*)<\/t>/.exec(m[1] || "") || [, ""])[1] : undefined;
};

await test("Excel：兩個工作表都讀到，欄位和測量日正確", () => {
  assert.deepEqual(wb.sheets.map((s) => s.name), ["小班", "大班"]);
  assert.deepEqual(wb.sheets[0].measure, { y: 2026, m: 3, d: 5 });
  assert.deepEqual(wb.sheets[0].cols, { name: 1, birth: 2, sex: 3, height: 5, weight: 7, heightOut: 6, weightOut: 8 });
  assert.equal(wb.sheets[0].rows.length, 2);   // 後面的空白列要略過
  assert.equal(wb.sheets[1].rows.length, 5);
});

await test("Excel：結果寫進 F、H 欄，數值和計算核心一致", () => {
  const expectBand = (birth, sex, kind, value) =>
    calc.classify(kind, sex, calc.ageOf(D(birth), D("2026-03-05")), value).band;
  assert.equal(cellText(0, "F4"), expectBand("2022-05-03", 1, "height", 98));
  assert.equal(cellText(0, "H4"), expectBand("2022-05-03", 1, "weight", 15.5));
  assert.equal(cellText(0, "F5"), expectBand("2023-01-20", 2, "height", 95.2));
  // 大班第一位：65 個月、體重 22.9 → 台灣表
  assert.equal(report.find((r) => r.row === 4 && r.sheet === "大班").standard, "TW");
  assert.equal(cellText(1, "H4"), expectBand("2020-09-10", 1, "weight", 22.9));
});

await test("Excel：缺資料留白、錯誤寫清楚", () => {
  assert.equal(cellText(1, "F5"), undefined);       // 缺體重 → 不寫
  assert.equal(cellText(1, "F7"), "格式錯誤");      // 13 月
  assert.equal(cellText(1, "F8"), "格式錯誤");      // 身高不是數字
  assert.notEqual(cellText(1, "H8"), "格式錯誤");   // 體重照樣算
  assert.equal(cellText(1, "F9"), "超出範圍");
  assert.ok(report.find((r) => r.sheet === "大班" && r.row === 5).issues.length);
});

await test("Excel：保留原本儲存格的樣式（s 屬性）", () => {
  assert.match(outBook.sheets[0].xml, /<c r="F4" s="1" t="inlineStr">/);
});

await test("Excel：結果欄不存在時，依欄位順序插入", () => {
  const row4 = /<row r="4">([\s\S]*?)<\/row>/.exec(outBook.sheets[1].xml)[1];
  const order = [...row4.matchAll(/<c r="([A-Z]+)4"/g)].map((m) => m[1]);
  assert.deepEqual(order, [...order].sort());
  assert.ok(order.includes("F") && order.includes("H"));
});

await test("Excel：除了兩個工作表，其他檔案一個位元組都沒變", async () => {
  const names = Object.keys(inZip.files).filter((n) => !inZip.files[n].dir);
  assert.deepEqual(Object.keys(outZip.files).filter((n) => !outZip.files[n].dir).sort(), names.sort());
  for (const n of names) {
    if (n.startsWith("xl/worksheets/")) continue;
    assert.equal(await outZip.file(n).async("string"), await inZip.file(n).async("string"), n);
  }
});

await test("Excel：工作表裡只有 F、H 欄被改", async () => {
  for (const n of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    const strip = (xml) => xml.replace(/<c r="[FH]\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, "")
      .replace(/<row r="(\d+)" spans="1:8"\/>/g, '<row r="$1" spans="1:8"></row>');
    assert.equal(strip(await outZip.file(n).async("string")), strip(await inZip.file(n).async("string")), n);
  }
});

await test("Excel：不是 xlsx 的檔案要給看得懂的錯誤", async () => {
  const z = new JSZip(); z.file("hello.txt", "hi");
  await assert.rejects(GrowthXlsx.readWorkbook(JSZip, await z.generateAsync({ type: "nodebuffer" })), /不是 Excel/);
});

/* ===== 結果 ===== */

console.log(failures.join("\n\n"));
console.log(`\n通過 ${passed}／${passed + failures.length}`);
process.exit(failures.length ? 1 : 0);
