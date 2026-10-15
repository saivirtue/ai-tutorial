"""從原始檔產生 who-lms.js、tw2010.js，以及測試用的 WHO 分界值抽樣。

原始檔不放進 repo（WHO 的四個 xlsx 加起來約 1 MB），下載網址見 README.md。
只用 Python 標準函式庫：xlsx 和 ods 都是 zip 包 XML，直接解析就好。

用法：
    python3 build_data.py <原始檔資料夾>

原始檔資料夾裡要有：
    wfa-boys-percentiles-expanded-tables.xlsx
    wfa-girls-percentiles-expanded-tables.xlsx
    lhfa-boys-percentiles-expanded-tables.xlsx
    lhfa-girls-percentiles-expanded-tables.xlsx
    hpa-growth.ods   （國健署「兒童生長曲線摺頁之圖表原始數據.ods」，改名成這個）
"""

import json
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PERCENTILES = ["P3", "P15", "P50", "P85", "P97"]


def read_xlsx_rows(path):
    """回傳第一個工作表的所有列，每列是字串串列（共用字串已展開）。"""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        xml = z.read("xl/sharedStrings.xml").decode("utf-8")
        shared = [re.sub(r"<[^>]+>", "", si) for si in re.findall(r"<si>(.*?)</si>", xml, re.S)]
    sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    rows = []
    for body in re.findall(r"<row[^>]*>(.*?)</row>", sheet, re.S):
        row = []
        for attrs, value in re.findall(r"<c([^>]*)>\s*<v>([^<]*)</v>", body):
            row.append(shared[int(value)] if 't="s"' in attrs else value)
        rows.append(row)
    return rows


def num(text):
    """'4.2259999999999999E-2' → 0.04226（取最短的十進位表示）。"""
    return float(repr(float(text)))


def read_who(path):
    """WHO expanded tables：Age（日齡）, L, M, S, P01, P1, P3, … 逐日一列（0–1856 天）。"""
    rows = read_xlsx_rows(path)
    header = rows[0]
    # 第一欄在 WHO 不同的檔案裡叫 Age 或 Day，都是日齡
    header[0] = "Day"
    col = {name: header.index(name) for name in ["Day", "L", "M", "S"] + PERCENTILES}
    table = {"L": [], "M": [], "S": [], "check": {}}
    for i, row in enumerate(rows[1:]):
        day = int(row[col["Day"]])
        if day != i:
            raise ValueError(f"{path.name}: 第 {i} 列的天數是 {day}，表格不連續")
        for k in "LMS":
            table[k].append(num(row[col[k]]))
        # 抽樣：每 100 天一筆，加上最後一天，給測試核對 WHO 自己公布的百分位值
        if day % 100 == 0 or day == 1856:
            table["check"][day] = [num(row[col[p]]) for p in PERCENTILES]
    if len(table["L"]) != 1857:
        raise ValueError(f"{path.name}: 預期 1857 天（0–1856），實際 {len(table['L'])}")
    return table


def read_ods_tables(path):
    """回傳 {工作表名稱: [[儲存格文字, …], …]}。"""
    ns_table = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
    import xml.etree.ElementTree as ET
    root = ET.fromstring(zipfile.ZipFile(path).read("content.xml"))
    sheets = {}
    for t in root.iter(ns_table + "table"):
        rows = []
        for r in t.iter(ns_table + "table-row"):
            cells = []
            for c in r.iter(ns_table + "table-cell"):
                repeat = min(int(c.get(ns_table + "number-columns-repeated", "1")), 30)
                cells += ["".join(c.itertext()).strip()] * repeat
            rows.append(cells)
        sheets[t.get(ns_table + "name")] = rows
    return sheets


def read_tw2010(path):
    """國健署表 1（男）、表 2（女）：每列是 年齡、體重 7 個百分位、空欄、身高 7 個百分位。

    只取 5–7 歲：0–5 歲政府網站用的是 WHO，表上的數值本來就是從 WHO 抄過來的。
    """
    sheets = read_ods_tables(path)
    wanted_ages = ["5", "5.5", "6", "6.5", "7"]
    # 表上有 3rd/15th/25th/50th/75th/85th/97th 七欄，只用其中五欄
    pick = [0, 1, 3, 5, 6]
    out = {}
    for sex, name in ((1, "表1"), (2, "表2")):
        rows = {r[0]: r for r in sheets[name] if r and r[0] in wanted_ages}
        if sorted(rows) != sorted(wanted_ages):
            raise ValueError(f"{name}: 找不到 5–7 歲的列，表格格式可能變了")
        out[sex] = {"ages": [float(a) for a in wanted_ages], "weight": [], "height": []}
        for a in wanted_ages:
            r = rows[a]
            weight, height = r[1:8], r[9:16]
            out[sex]["weight"].append([float(weight[i]) for i in pick])
            out[sex]["height"].append([float(height[i]) for i in pick])
    return out


def format_tw(tw):
    """每個年齡一列，方便和國健署原表逐列對照。"""
    lines = ["{"]
    for sex in (1, 2):
        t = tw[sex]
        lines.append(f'  "{sex}": {{  // {"男" if sex == 1 else "女"}')
        lines.append(f'    ages: {json.dumps(t["ages"])},')
        for kind in ("weight", "height"):
            lines.append(f"    {kind}: [")
            for age, row in zip(t["ages"], t[kind]):
                lines.append(f"      {json.dumps(row)},  // {age:g} 歲")
            lines.append("    ],")
        lines.append("  },")
    lines.append("}")
    return "\n".join(lines)


def main():
    src = Path(sys.argv[1])
    who = {}
    checks = {}
    for kind, prefix in (("weight", "wfa"), ("height", "lhfa")):
        who[kind] = {}
        for sex, label in ((1, "boys"), (2, "girls")):
            t = read_who(src / f"{prefix}-{label}-percentiles-expanded-tables.xlsx")
            checks[f"{kind}-{sex}"] = t.pop("check")
            who[kind][sex] = t
    tw = read_tw2010(src / "hpa-growth.ods")

    (HERE / "who-lms.js").write_text(
        "/* WHO 2006 兒童生長標準：擴充版逐日 LMS 參數（0–1856 天）。\n"
        "   由 build_data.py 產生，不要手動改；來源見 README.md。\n"
        "   結構：GROWTH_WHO[指標][性別] = { L: [...], M: [...], S: [...] }，陣列索引就是日齡。\n"
        "   指標：weight＝體重、height＝身長／身高；性別：1＝男、2＝女。 */\n"
        "var GROWTH_WHO = " + json.dumps(who, separators=(",", ":")) + ";\n"
        'if (typeof module !== "undefined") module.exports = GROWTH_WHO;\n',
        encoding="utf-8",
    )
    (HERE / "tw2010.js").write_text(
        "/* 台灣 2010 兒童生長標準（陳偉德、張美惠），5–7 歲的百分位分界值。\n"
        "   由 build_data.py 產生，不要手動改；來源見 README.md。\n"
        "   結構：GROWTH_TW[性別] = { ages: [歲…], weight: [[P3,P15,P50,P85,P97]…], height: […] }。 */\n"
        "var GROWTH_TW = " + format_tw(tw) + ";\n"
        'if (typeof module !== "undefined") module.exports = GROWTH_TW;\n',
        encoding="utf-8",
    )
    (HERE.parent / "test" / "who-check.json").write_text(
        json.dumps(
            {"_說明": "WHO expanded tables 自己公布的 P3/P15/P50/P85/P97（抽樣），測試用來核對 LMS 算出來的分界值",
             **checks},
            ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print("完成：who-lms.js、tw2010.js、../test/who-check.json")


if __name__ == "__main__":
    main()
