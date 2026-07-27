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

SwitchBot 實體回饋（--switchbot 參數）：
  off     不處理（預設）——遊戲送里程碑事件時直接忽略
  mock    不連真藍牙，只記錄下來，給 GET /switchbot/log 檢查（測試用）
  <MAC位址>  例如 AA:BB:CC:DD:EE:FF，真的用藍牙連線按下 SwitchBot Bot
遊戲網頁在達成里程碑（破關、集滿星星…）時會透過 WebSocket 送
  {"type": "milestone"}
伺服器收到後會觸發 SwitchBot 按一下實體按鈕。

跟讀語音辨識（--mic 參數）：
  on      預設。用筆電內建麥克風錄音＋Google 語音辨識（需要網路）
  off     不處理，遊戲送 listen 時直接回覆「沒開啟」
  mock    不錄音，回覆 GET /mock_speech?text=XXX 設定的文字（測試用）
遊戲網頁送 {"type": "listen"}，伺服器錄音幾秒、辨識完送回
  {"type": "heard", "text": "...", "error": null}
（聽不清楚或沒開麥克風時 text 是 null，error 會有原因）
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

# ====================== SwitchBot ======================
# 社群常見的 SwitchBot Bot「無密碼」BLE press 指令
SWITCHBOT_CHAR_UUID = "cba20002-224d-11e6-9fb8-0002a5d5c51b"
SWITCHBOT_PRESS_COMMAND = bytes([0x57, 0x01, 0x00])

switchbot_mode = "off"      # "off" / "mock" / MAC 位址字串
switchbot_log = []          # mock 模式：記錄每次觸發的時間，給測試讀取


async def trigger_switchbot():
    """收到里程碑事件時呼叫；依模式決定要不要真的按下 SwitchBot。
    包在 try/except 裡，藍牙失敗只印訊息，不能讓伺服器掛掉。"""
    if switchbot_mode == "off":
        return

    if switchbot_mode == "mock":
        switchbot_log.append(time.time())
        print(f"🔔 (mock) 按下 SwitchBot！（第 {len(switchbot_log)} 次）")
        return

    try:
        from bleak import BleakClient

        async with BleakClient(switchbot_mode) as client:
            await client.write_gatt_char(SWITCHBOT_CHAR_UUID, SWITCHBOT_PRESS_COMMAND)
        print("🔔 SwitchBot 按下去了！")
    except Exception as e:
        print(f"⚠️  SwitchBot 觸發失敗：{e}（裝置是否有設密碼？參考 README）")


# ====================== 跟讀語音辨識 ======================

LISTEN_SECONDS = 2.5
SPEECH_SAMPLE_RATE = 16000

mic_mode = "on"        # "on" / "off" / "mock"
mock_speech_text = ""  # mock 模式：/mock_speech 設定的「假裝聽到的話」
mic_broken_warned = False  # 麥克風壞掉的訊息只印一次，不要洗畫面


def record_and_recognize():
    """錄 LISTEN_SECONDS 秒的音，用 Google 語音辨識轉成文字。
    這個函式會卡住（阻塞），一定要丟到背景執行緒／executor 裡跑，
    不能直接在 asyncio 的事件迴圈裡呼叫。"""
    import sounddevice as sd
    import speech_recognition as sr

    audio = sd.rec(int(LISTEN_SECONDS * SPEECH_SAMPLE_RATE), samplerate=SPEECH_SAMPLE_RATE, channels=1, dtype="int16")
    sd.wait()
    audio_data = sr.AudioData(audio.tobytes(), SPEECH_SAMPLE_RATE, 2)

    recognizer = sr.Recognizer()
    try:
        return recognizer.recognize_google(audio_data, language="zh-TW"), None
    except sr.UnknownValueError:
        return None, "no_speech"
    except sr.RequestError as e:
        return None, f"network:{e}"


async def handle_listen(ws):
    """收到遊戲頁面的 {"type": "listen"} 時呼叫；錄音辨識完送回 heard 事件。"""
    global mic_broken_warned

    if mic_mode == "off":
        await ws.send_str(json.dumps({"type": "heard", "text": None, "error": "mic_disabled"}))
        return

    if mic_mode == "mock":
        await asyncio.sleep(0.5)   # 假裝錄音需要一點時間，體驗比較真實
        text = mock_speech_text or None
        await ws.send_str(json.dumps({"type": "heard", "text": text, "error": None if text else "no_speech"}))
        return

    try:
        loop = asyncio.get_event_loop()
        text, err = await loop.run_in_executor(None, record_and_recognize)
    except Exception as e:
        if not mic_broken_warned:
            mic_broken_warned = True
            print(
                f"⚠️  麥克風錄音失敗（{e}）。跟讀小鸚鵡沒辦法用，其他遊戲不受影響。\n"
                "   請執行：cd server && source .venv/bin/activate && "
                "pip install SpeechRecognition sounddevice 然後重開伺服器，"
                "並確認終端機有麥克風權限（系統設定 → 隱私權與安全性 → 麥克風）。"
            )
        text, err = None, "server_error"

    await ws.send_str(json.dumps({"type": "heard", "text": text, "error": err}))


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

    try:
        hands = mp.solutions.hands.Hands(
            model_complexity=0,          # 用小模型，速度快
            max_num_hands=2,             # 兩隻手一起比可以到 10
            min_detection_confidence=0.6,
            min_tracking_confidence=0.5,
        )
    except AttributeError:
        print(
            "❌ mediapipe 版本不對，缺少 solutions API（比手指功能沒辦法用，"
            "但網頁和其他遊戲照常能玩）。\n"
            "   請執行：cd server && source .venv/bin/activate && "
            "pip install 'mediapipe==0.10.14' 然後重開伺服器。"
        )
        return

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
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                if data.get("type") == "milestone":
                    # 不要 await：BLE 可能很慢，不能卡住這個 WebSocket 的收訊迴圈
                    asyncio.create_task(trigger_switchbot())
                elif data.get("type") == "listen":
                    # 不要 await：錄音要好幾秒，不能卡住這個 WebSocket 的收訊迴圈
                    asyncio.create_task(handle_listen(ws))
    finally:
        websockets.discard(ws)
    return ws


async def mock_handler(request):
    """測試用：GET /mock?count=5 假裝看到 5 根手指；不帶 count 表示沒看到手。"""
    raw = request.query.get("count")
    latest["count"] = int(raw) if raw is not None else None
    return web.json_response({"ok": True, "count": latest["count"]})


async def switchbot_log_handler(request):
    """測試用：查 mock 模式下 SwitchBot 被觸發了幾次。"""
    return web.json_response({"count": len(switchbot_log)})


async def mock_speech_handler(request):
    """測試用：GET /mock_speech?text=波 設定下一次 listen 事件「假裝聽到的話」；
    不帶 text 表示假裝什麼都沒聽到。"""
    global mock_speech_text
    mock_speech_text = request.query.get("text", "")
    return web.json_response({"ok": True, "text": mock_speech_text})


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
    print(f"   SwitchBot：{switchbot_mode}")
    print(f"   跟讀麥克風：{mic_mode}")
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
    global switchbot_mode, mic_mode

    parser = argparse.ArgumentParser(description="親子遊戲視覺伺服器")
    parser.add_argument("--source", choices=["oakd", "webcam", "mock"], default="oakd")
    parser.add_argument(
        "--switchbot",
        default="off",
        help="off（預設）/ mock（測試用）/ 實際 MAC 位址，例如 AA:BB:CC:DD:EE:FF",
    )
    parser.add_argument("--mic", choices=["on", "off", "mock"], default="on", help="跟讀小鸚鵡用的麥克風（預設 on）")
    args = parser.parse_args()
    switchbot_mode = args.switchbot
    mic_mode = args.mic

    if args.source != "mock":
        thread = threading.Thread(target=vision_loop, args=(args.source,), daemon=True)
        thread.start()
    else:
        print("🧪 mock 模式：用 GET /mock?count=N 假裝手指數")

    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/mock", mock_handler)
    app.router.add_get("/switchbot/log", switchbot_log_handler)
    app.router.add_get("/mock_speech", mock_speech_handler)
    app.router.add_get("/{tail:.*}", static_handler)
    app.on_startup.append(start_background)

    print_welcome(args.source)
    web.run_app(app, port=PORT, print=None)


if __name__ == "__main__":
    main()
