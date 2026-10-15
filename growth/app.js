/* 生長曲線百分位 — 畫面

   流程：選檔案 → 讀取、計算（全部在瀏覽器裡）→ 顯示摘要 → 下載填好的檔案。
   輸出檔名照舊 notebook 的習慣：生長曲線_<原檔名>。 */

var calc = createGrowthCalc(GROWTH_WHO, GROWTH_TW);

var state = {
  fileName: "",
  workbook: null,
  results: null,
};

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function showError(msg) {
  $("error").textContent = msg;
  $("error").hidden = false;
  $("result").hidden = true;
}

function ageText(age) {
  return age.years + " 歲 " + age.months + " 個月";
}

function render(report) {
  var sheets = state.workbook.sheets;
  $("file-name").textContent = state.fileName;

  var done = report.filter(function (r) { return r.height && r.issues.length === 0; }).length;
  var flagged = report.length - done;
  $("counts").textContent = sheets.length + " 個工作表，" + report.length + " 位學生：完成 " + done + " 位" +
    (flagged ? "，" + flagged + " 位需要確認" : "");

  // 整個工作表讀不了的原因
  var problems = sheets.filter(function (s) { return s.problem; });
  $("notices").innerHTML = problems.length
    ? '<div class="notice"><ul>' + problems.map(function (s) {
        return "<li>工作表「" + esc(s.name) + "」：" + esc(s.problem) + "</li>";
      }).join("") + "</ul></div>"
    : "";

  $("tables").innerHTML = sheets.filter(function (s) { return !s.problem; }).map(function (s) {
    var rows = report.filter(function (r) { return r.sheet === s.name; });
    var m = s.measure;
    return "<h2>" + esc(s.name) + '<span class="tag">測量日 ' + m.y + "/" + m.m + "/" + m.d + "</span></h2>" +
      '<div class="table-scroll"><table><thead><tr>' +
      "<th>列</th><th>姓名</th><th>年齡</th><th>身高</th><th>體重</th><th>備註</th>" +
      "</tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><td>" + r.row + "</td><td>" + esc(r.name) + "</td>" +
          "<td>" + (r.age ? ageText(r.age) : "") + (r.standard === "TW" ? '<span class="tag">台灣表</span>' : "") + "</td>" +
          '<td class="band">' + esc(r.height || "") + "</td>" +
          '<td class="band">' + esc(r.weight || "") + "</td>" +
          '<td class="note">' + esc(r.issues.join("；")) + "</td></tr>";
      }).join("") +
      "</tbody></table></div>";
  }).join("");

  $("download").disabled = state.results.length === 0;
  $("error").hidden = true;
  $("result").hidden = false;
}

function handleFile(file) {
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) {
    showError("請選擇 .xlsx 檔。舊版的 .xls 請先用 Excel 打開，另存成「Excel 活頁簿 (.xlsx)」。");
    return;
  }
  state.fileName = file.name;
  file.arrayBuffer()
    .then(function (buf) { return GrowthXlsx.readWorkbook(JSZip, buf); })
    .then(function (wb) {
      state.workbook = wb;
      var out = processWorkbook(calc, GrowthXlsx, wb);
      state.results = out.results;
      render(out.report);
      if (!wb.sheets.some(function (s) { return !s.problem; })) {
        $("counts").textContent = "沒有找到可以計算的工作表。";
      }
    })
    .catch(function (e) {
      showError("讀取失敗：" + (e && e.message ? e.message : e));
    });
}

function download() {
  GrowthXlsx.writeResults(state.workbook, state.results)
    .generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      compression: "DEFLATE",
    })
    .then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "生長曲線_" + state.fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
}

$("file").addEventListener("change", function (e) {
  handleFile(e.target.files[0]);
  e.target.value = ""; // 同一個檔案再選一次也要觸發
});

var drop = $("drop");
["dragenter", "dragover"].forEach(function (t) {
  drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); });
});
["dragleave", "drop"].forEach(function (t) {
  drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); });
});
drop.addEventListener("drop", function (e) {
  handleFile(e.dataTransfer.files[0]);
});

$("download").addEventListener("click", download);
$("again").addEventListener("click", function () {
  $("result").hidden = true;
  $("file").click();
});
