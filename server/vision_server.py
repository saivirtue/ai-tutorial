#!/usr/bin/env python3
"""親子遊戲視覺伺服器

一個伺服器做兩件事：
1. 服務遊戲網頁（手機開 http://<筆電IP>:8000 就能玩）
2. 用鏡頭數手指，透過 WebSocket 即時告訴遊戲頁面

影像來源（--source 參數）：
  oakd    OAK-D 鏡頭（預設；沒插或失敗會自動改用筆電鏡頭）
  webcam  筆電內建鏡頭
  mock    不開鏡頭，用 GET /mock?count=N 假裝看到 N 根手指（測試用）

送給網頁的事件（JSON）：
  {"type": "fingers", "count": N}   即時看到幾根手指（沒看到手是 null）
  {"type": "answer",  "count": N}   同一個數字穩定比了一秒，當作正式回答
"""

import argparse
import asyncio
import json
import socket
import threading
import time
from pathlib import Path

from aiohttp import WSMsgType, web

ROOT = Path(__file__).resolve().parent.parent  # repo 根目錄（遊戲網頁在這）

PORT = 8000
ANSWER_HOLD_SECONDS = 1.0   # 同一個手指數比多久才算「回答」
BROADCAST_HZ = 10           # 每秒最多送幾次 fingers 事件

# 視覺執行緒把最新結果放這裡，asyncio 這邊定時拿去廣播
latest = {"count": None}


# ====================== 影像來源 ======================

def frames_from_oakd():
    """從 OAK-D 拿影像。lazy import：mock 模式完全不需要裝 depthai。"""
    import depthai as dai

    pipeline = dai.Pipeline()
    cam = pipeline.create(dai.node.ColorCamera)
    cam.setPreviewSize(640, 360)
    cam.setInterleaved(False)
    xout = pipeline.create(dai.node.XLinkOut)
    xout.setStreamName("preview")
    cam.preview.link(xout.input)

    with dai.Device(pipeline) as device:
        print("✅ OAK-D 已連線！")
        queue = device.getOutputQueue("preview", maxSize=4, blocking=False)
        while True:
            yield queue.get().getCvFrame()


def frames_from_webcam():
    """從筆電內建鏡頭拿影像。"""
    import cv2

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("打不開筆電鏡頭（檢查系統設定是否允許終端機使用相機）")
    print("✅ 筆電鏡頭已開啟！")
    while True:
        ok, frame = cap.read()
        if not ok:
            time.sleep(0.05)
            continue
        yield frame


# ====================== 數手指 ======================

def count_fingers(hand, handedness_label):
    """一隻手比了幾根手指。

    lm[i] 是 MediaPipe 的手部關鍵點（0～20），座標是 0~1 的比例：
    食指到小指：指尖(tip)比第二關節(pip)「高」（y 比較小）就算伸出來。
    拇指：橫著長，用 x 判斷，而且左右手方向相反。
    """
    lm = hand.landmark
    count = 0
    for tip in (8, 12, 16, 20):          # 食指、中指、無名指、小指的指尖
        if lm[tip].y < lm[tip - 2].y:
            count += 1
    if handedness_label == "Right":
        if lm[4].x < lm[3].x:
            count += 1
    else:
        if lm[4].x > lm[3].x:
            count += 1
    return count


def vision_loop(source):
    """背景執行緒：不停地「拿影像 → 數手指 → 更新 latest」。"""
    import cv2
    import mediapipe as mp

    if source == "oakd":
        try:
            frames = frames_from_oakd()
            next(frames)  # 先試拿一張，確認 OAK-D 真的在
        except Exception as e:
            print(f"⚠️  OAK-D 連不上（{e}），改用筆電鏡頭")
            frames = frames_from_webcam()
    else:
        frames = frames_from_webcam()

    hands = mp.solutions.hands.Hands(
        model_complexity=0,          # 用小模型，速度快
        max_num_hands=2,             # 兩隻手一起比可以到 10
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
    )

    for frame in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = hands.process(rgb)

        if result.multi_hand_landmarks:
            total = 0
            for hand, handedness in zip(result.multi_hand_landmarks, result.multi_handedness):
                total += count_fingers(hand, handedness.classification[0].label)
            latest["count"] = total
        else:
            latest["count"] = None   # 沒看到手

        time.sleep(1 / 20)           # 最多 20fps，別把 CPU 吃滿


# ====================== 網頁伺服器 ======================

websockets = set()


async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    websockets.add(ws)
    print(f"🎮 遊戲頁面連上了（目前 {len(websockets)} 個）")
    try:
        async for msg in ws:
            if msg.type == WSMsgType.ERROR:
                break
    finally:
        websockets.discard(ws)
    return ws


async def mock_handler(request):
    """測試用：GET /mock?count=5 假裝看到 5 根手指；不帶 count 表示沒看到手。"""
    raw = request.query.get("count")
    latest["count"] = int(raw) if raw is not None else None
    return web.json_response({"ok": True, "count": latest["count"]})


async def static_handler(request):
    """服務遊戲網頁；資料夾網址自動給 index.html。"""
    path = (ROOT / request.match_info["tail"]).resolve()
    if ROOT not in path.parents and path != ROOT:
        raise web.HTTPNotFound()
    if path.is_dir():
        path = path / "index.html"
    if path.is_file():
        return web.FileResponse(path)
    raise web.HTTPNotFound()


async def broadcaster(app):
    """定時把 latest 廣播給所有遊戲頁面，並判斷「穩定一秒＝回答」。"""
    last_sent = "?"          # 上次送出去的 fingers 數
    hold_start = None        # 目前這個數字從什麼時候開始比
    answered = False         # 這一輪比的數字回答過了嗎

    while True:
        await asyncio.sleep(1 / BROADCAST_HZ)
        count = latest["count"]

        events = []
        if count != last_sent:
            events.append({"type": "fingers", "count": count})
            last_sent = count
            hold_start = time.monotonic()
            answered = False

        # 同一個數字（至少 1）比滿一秒 → 當作正式回答，只送一次
        if (
            count is not None and count >= 1 and not answered
            and hold_start is not None
            and time.monotonic() - hold_start >= ANSWER_HOLD_SECONDS
        ):
            events.append({"type": "answer", "count": count})
            answered = True

        for event in events:
            data = json.dumps(event)
            for ws in list(websockets):
                try:
                    await ws.send_str(data)
                except ConnectionResetError:
                    websockets.discard(ws)


def lan_ip():
    """查筆電在區網的 IP（手機要連的那個）。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def print_welcome(source):
    url = f"http://{lan_ip()}:{PORT}"
    print()
    print("=" * 46)
    print("🎪 小小遊戲樂園 伺服器啟動！")
    print(f"   影像來源：{source}")
    print(f"   手機（跟筆電同一個 WiFi）請開：{url}")
    print("=" * 46)
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.print_ascii(tty=True)
        print("（手機相機掃上面的 QR code 就能開）")
    except ImportError:
        pass
    print()


async def start_background(app):
    app["broadcaster"] = asyncio.create_task(broadcaster(app))


def main():
    parser = argparse.ArgumentParser(description="親子遊戲視覺伺服器")
    parser.add_argument("--source", choices=["oakd", "webcam", "mock"], default="oakd")
    args = parser.parse_args()

    if args.source != "mock":
        thread = threading.Thread(target=vision_loop, args=(args.source,), daemon=True)
        thread.start()
    else:
        print("🧪 mock 模式：用 GET /mock?count=N 假裝手指數")

    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/mock", mock_handler)
    app.router.add_get("/{tail:.*}", static_handler)
    app.on_startup.append(start_background)

    print_welcome(args.source)
    web.run_app(app, port=PORT, print=None)


if __name__ == "__main__":
    main()
