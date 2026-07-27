#!/bin/bash
# macOS 一鍵啟動：建虛擬環境、裝套件、啟動視覺伺服器
# 用法：
#   ./start.sh                  # 用 OAK-D（沒插會自動改用筆電鏡頭）
#   ./start.sh --source webcam  # 直接用筆電鏡頭
#   ./start.sh --source mock    # 不開鏡頭（測試）
#   ./start.sh --switchbot AA:BB:CC:DD:EE:FF   # 里程碑時按下 SwitchBot
#   ./start.sh --switchbot mock                # SwitchBot 測試模式（不用真裝置）
#   ./start.sh --mic off                       # 關閉跟讀小鸚鵡的麥克風功能
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "第一次執行，建立 Python 環境（要幾分鐘）…"
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

python vision_server.py "$@"
