#!/bin/bash
# macOS 一鍵啟動：建虛擬環境、裝套件、啟動視覺伺服器
# 用法：
#   ./start.sh                  # 用 OAK-D（沒插會自動改用筆電鏡頭）
#   ./start.sh --source webcam  # 直接用筆電鏡頭
#   ./start.sh --source mock    # 不開鏡頭（測試）
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "第一次執行，建立 Python 環境（要幾分鐘）…"
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

python vision_server.py "$@"
