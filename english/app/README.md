# English Coach（選單列小工具）

快捷鍵 **⌃⌥E**（Control + Option + E）叫出小視窗，輸入今天聽／讀了什麼，一次一題，打 2～3 句就好。

- 全程安靜，不用開口。
- 沒有連續天數、沒有進度條。
- 卡住時點題目下面的開頭句，會自動填進輸入框。
- **存起來**：附加到 `~/EnglishCoach/yyyy-MM.md`，之後可以拿來做週回顧。
- **複製並開 Claude**：把題目和你的回答複製好，開啟 claude.ai，貼上即可（Claude Project 裡放 `../daily-prompt.md`）。

## 編譯

不需要 Xcode，只需要命令列工具：

    xcode-select --install     # 已經有的話會告訴你
    ./english/app/build.sh
    open english/app/build/EnglishCoach.app

macOS 升級後如果 `swift build` 抱怨 SDK 版本，到「系統設定 → 一般 → 軟體更新」更新命令列工具。

## 尚未做

- 直接呼叫 Claude 給回饋（需要先確認 Pro 方案能否以 `claude -p` 這樣使用）
- 朗讀「更自然的說法」跟讀
- 開機自動啟動
