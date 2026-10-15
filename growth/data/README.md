# 生長標準數據（由 `build_data.py` 產生，不要手動改）

| 檔案 | 內容 | 來源 |
|------|------|------|
| `who-lms.js` | WHO 2006 兒童生長標準，**擴充版逐日** LMS 參數（0–1856 天），身長／身高、體重，男女各一 | WHO Child Growth Standards — expanded tables（下載網址見下方） |
| `tw2010.js` | 台灣 2010 兒童生長標準（陳偉德、張美惠），5–7 歲每半歲的 P3／P15／P50／P85／P97 | 國民健康署「[0-7歲兒童生長曲線](https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=1596&pid=549)」頁面的「兒童生長曲線摺頁之圖表原始數據.ods」 |
| `../test/who-check.json` | WHO 自己公布的百分位值（抽樣），測試用來核對 LMS 算出來的分界值 | 同上 WHO 檔案 |

原始檔下載日期：2026-10-15。

## 為什麼是這兩份、這樣接

目標是和國健署健康九九⁺「[新版兒童生長曲線](https://health99.hpa.gov.tw/health99/HealthCheck/Detail?nodeId=115&type=ChildGrowthCurve)」算出一樣的結果。對照政府網站的前端程式和實際查詢結果，它的做法是：

- **未滿 1857 天**：WHO 2006，依日齡。WHO 的逐日表正好到第 1856 天，所以分界在 1857，不是 5 歲整（1826 天）。
  注意：WHO 官方 R 套件 `anthro` 內附的表只到 1826 天，**不能用**；要用 WHO 網站上的 expanded tables。
- **滿 1857 天到 7 歲**：國健署公布的台灣 2010 百分位表，用「歲×12＋月」的月齡在半歲之間線性內插。
  這份表只有分界值，沒有 LMS，所以這段只能判斷區間。

逐項的驗證紀錄在 `.chat-context/WIP_生長曲線.md`；能自動重跑的部分在 `../test/run.mjs`。

## 重新產生

把下列檔案放進同一個資料夾，然後執行 `python3 build_data.py <資料夾>`（只需要 Python 標準函式庫）：

- WHO 體重：`wfa-boys-percentiles-expanded-tables.xlsx`、`wfa-girls-percentiles-expanded-tables.xlsx`
  `https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/weight-for-age/expanded-tables/<檔名>`
- WHO 身長／身高：`lhfa-boys-percentiles-expanded-tables.xlsx`、`lhfa-girls-percentiles-expanded-tables.xlsx`
  `https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/length-height-for-age/expandable-tables/<檔名>`
  （身高這組的路徑是 `expandable-tables`，跟體重的 `expanded-tables` 不一樣，不是打錯）
- 國健署：「兒童生長曲線摺頁之圖表原始數據.ods」，改名成 `hpa-growth.ods`

產生完跑一次 `node growth/test/run.mjs`，確認全部通過。
