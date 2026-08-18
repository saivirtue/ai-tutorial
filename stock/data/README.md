# 每日快照（機器產生，不要手動改）

這個資料夾裡的 JSON 由 [`.github/workflows/stock-data.yml`](../../.github/workflows/stock-data.yml)
每天收盤後自動抓取並 commit，網頁 (`stock/index.html`) 讀的就是這裡。

## 為什麼要有這個資料夾

證交所的 OpenAPI **不回 `Access-Control-Allow-Origin`**（四個端點實測都沒有），
所以瀏覽器沒辦法直接跨域抓。常見解法是架一個 proxy，但這些資料本來就
**一天只變一次**——與其每次開網頁都繞道去打證交所，不如每天抓一次存成
靜態檔案，網頁讀同源檔案。CORS 問題因此根本不存在，載入也快得多。

## 檔案

| 檔案 | 來源端點 | 內容 |
|------|---------|------|
| `daily.json` | `exchangeReport/STOCK_DAY_ALL` | 個股日成交資訊 |
| `valuation.json` | `exchangeReport/BWIBBU_ALL` | 本益比／殖利率／股價淨值比 |
| `revenue.json` | `opendata/t187ap05_L` | 每月營業收入（也是**產業別**的來源） |
| `institution.json` | `fund/T86` | 三大法人買賣超 |
| `meta.json` | — | 抓取時間與各來源狀態 |
| `market-history.json` | 由 `daily.json`／`valuation.json` 算出 | 全市場本益比／殖利率中位數，**每個交易日一筆，逐日累積**（見下方說明） |

## 抓不到的時候會怎樣

工作流程**不會**用失敗結果覆蓋既有快照——寧可讓網頁顯示昨天的資料，
也不要因為證交所今天沒回應就整頁空白。這種情況 `meta.json` 裡該來源的
`status` 會是 `stale`。

## 手動更新

Actions 分頁 → 「更新台股快照」→ Run workflow。

## `market-history.json` 為什麼是中位數，不是「大盤本益比」

正規的大盤本益比要用市值加權，市值需要在外流通股數——免費的證交所
API 沒有這個資料，所以不假裝算得出來。這裡改算全市場本益比／殖利率的
**中位數**：只用已經在抓的 `daily`／`valuation` 兩份資料，不用新端點、
不碰新網域。中位數比平均數更抗極端值干擾（少數本益比異常高的公司不會
把數字拉偏）。

這份資料**逐日累積**，同一天重跑會覆蓋掉那天的舊值，不會產生重複。
本益比河流圖傳統上需要幾年的歷史資料才有意義，這份資料是從這個功能
上線那天才開始算——資料不夠深的時候，網頁上只會顯示原始數字，不會
假裝算得出「相對貴或便宜」的結論。
