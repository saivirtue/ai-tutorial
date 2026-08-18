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

## 抓不到的時候會怎樣

工作流程**不會**用失敗結果覆蓋既有快照——寧可讓網頁顯示昨天的資料，
也不要因為證交所今天沒回應就整頁空白。這種情況 `meta.json` 裡該來源的
`status` 會是 `stale`。

## 手動更新

Actions 分頁 → 「更新台股快照」→ Run workflow。
