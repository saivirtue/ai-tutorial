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
  {"type": "hand", "x": 0~1, "y": 0~1}   手掌在畫面上的位置（沒看到手是 null）
  {"type": "gesture", "name": "push"}    手往前揮（像打地鼠那樣打出去）
  {"type": "gesture", "name": "swipe", "dir": "up"/"down"/"left"/"right"}

手勢是為了讓小孩「站遠一點用身體玩」——點螢幕一定要靠近電視或手機，
對小孩的眼睛和姿勢都不好。手勢只用手掌位置和大小判斷，不需要看清楚
每根手指，所以比「數手指」還能站得遠。

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
遊戲網頁送 {"type": "listen"}，伺服器開始錄音，小孩「講完就自動停」
（不是固定錄幾秒——小孩會先一個一個唸注音再拼出整個字，中間還會停頓），
辨識完送回
  {"type": "heard", "text": "...", "error": null}
（聽不清楚或沒開麥克風時 text 是 null，error 會有原因）

貼紙收集簿存檔：
  GET  /stickers        拿目前的收集簿
  POST /stickers/apply  送一筆變更（得到貼紙／花掉／贏獎品／換錢／獎盃）
存成 server/sticker-book.json。這樣換 Wi-Fi、換筆電 IP、關掉電視盒
瀏覽器，小孩收集的貼紙都不會不見。
"""

import argparse
import asyncio
import json
import math
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
latest_hand = {"x": None, "y": None}     # 手掌在畫面上的位置（0~1），沒看到手是 None


# ====================== 貼紙收集簿存檔 ======================

STICKER_FILE = Path(__file__).resolve().parent / "sticker-book.json"


def empty_book():
    return {"stickers": {}, "trophies": {}, "prizes": {}, "redeemed": 0}


def load_sticker_book():
    """讀存檔；檔案不在或壞掉就當作全新的一本，不要讓伺服器掛掉。"""
    try:
        with open(STICKER_FILE, encoding="utf-8") as f:
            data = json.load(f)
        book = empty_book()
        book.update({k: v for k, v in data.items() if k in book})
        return book
    except (OSError, ValueError):
        return empty_book()


def save_sticker_book(book):
    try:
        with open(STICKER_FILE, "w", encoding="utf-8") as f:
            json.dump(book, f, ensure_ascii=False, indent=2)
    except OSError as e:
        print(f"⚠️  貼紙存檔失敗：{e}")


def apply_sticker_action(book, action):
    """把一筆變更套用到收集簿上。
    收「發生了什麼事」而不是整本收集簿，這樣兩台裝置同時在玩也不會
    互相蓋掉對方的進度。"""
    kind = action.get("type")

    if kind == "award" and action.get("sticker"):
        emoji = action["sticker"]
        book["stickers"][emoji] = book["stickers"].get(emoji, 0) + 1

    elif kind == "spend":
        left = int(action.get("count", 0))
        # 從數量最多的先扣，跟網頁那邊同一套規則
        for emoji in sorted(book["stickers"], key=lambda e: -book["stickers"][e]):
            if left <= 0:
                break
            take = min(left, book["stickers"][emoji])
            book["stickers"][emoji] -= take
            left -= take

    elif kind == "prize" and action.get("prize"):
        emoji = action["prize"]
        book["prizes"][emoji] = book["prizes"].get(emoji, 0) + 1

    elif kind == "redeem":
        book["prizes"] = {}
        book["redeemed"] = book.get("redeemed", 0) + 1

    elif kind == "trophy" and action.get("id"):
        book["trophies"][action["id"]] = True

    return book

# ====================== 手勢 ======================
# 為什麼要做手勢：點螢幕一定要走到電視或手機前面，小孩會越靠越近。
# 用手勢就可以站遠一點、用整隻手臂玩。而且手勢只看「手掌在哪、多大」，
# 不用看清楚每一根手指，所以比「數手指」還能站得更遠。

PUSH_GROWTH = 1.18       # 手掌在 PUSH_WINDOW 內變大幾倍算「往前揮」
PUSH_WINDOW = 0.35       # 秒
SWIPE_DISTANCE = 0.22    # 手掌位置移動多少（畫面寬度的比例）算「揮」
SWIPE_WINDOW = 0.40      # 秒
GESTURE_COOLDOWN = 0.45  # 出了一個手勢之後，這段時間內不再出下一個
                         # （打地鼠要連打，所以不能設太久；出過手勢會把
                         #   歷史清空，本來就至少要再累積 PUSH_WINDOW 秒）

pending_gestures = []              # 視覺執行緒放進來，廣播迴圈拿走
gesture_lock = threading.Lock()    # 兩個執行緒都會碰，要上鎖


def emit_gesture(name, **extra):
    event = {"type": "gesture", "name": name}
    event.update(extra)
    with gesture_lock:
        pending_gestures.append(event)


def take_gestures():
    """把累積的手勢事件拿走（拿完就清空）。"""
    with gesture_lock:
        events = pending_gestures[:]
        del pending_gestures[:]
    return events


class GestureTracker:
    """看手掌的位置和大小怎麼變，判斷小孩做了什麼手勢。

    往前揮（push）：手靠近鏡頭的時候，手掌在畫面上會變大——短時間內
        變大超過 PUSH_GROWTH 倍就算揮出去了。不需要深度鏡頭，一般
        webcam 也能用。
    左右上下揮（swipe）：手掌位置在短時間內移動超過 SWIPE_DISTANCE。

    兩種手勢會互相干擾（往前揮的時候手多少也會左右晃），所以先判斷
    往前揮，而且出過一個手勢之後要冷卻一下才會出下一個。
    """

    def __init__(self):
        self.history = []       # [(時間, x, y, 手掌大小)]
        self.last_fired = 0.0

    def reset(self):
        """看不到手了：把歷史清掉，免得手再出現時算出一個假的大位移。"""
        self.history = []

    def update(self, x, y, scale):
        now = time.monotonic()
        self.history.append((now, x, y, scale))

        # 只留最近這一小段時間，不然會越積越多
        cutoff = now - max(PUSH_WINDOW, SWIPE_WINDOW)
        self.history = [entry for entry in self.history if entry[0] >= cutoff]

        if now - self.last_fired < GESTURE_COOLDOWN:
            return

        # --- 往前揮：手掌變大 ---
        old = self._oldest_within(now, PUSH_WINDOW)
        if old and old[3] > 0 and scale / old[3] >= PUSH_GROWTH:
            self._fire(now, "push", x=round(x, 3), y=round(y, 3))
            return

        # --- 左右上下揮：手掌位置大幅移動 ---
        old = self._oldest_within(now, SWIPE_WINDOW)
        if not old:
            return
        dx = x - old[1]
        dy = y - old[2]
        if abs(dx) >= SWIPE_DISTANCE and abs(dx) > abs(dy):
            self._fire(now, "swipe", dir="right" if dx > 0 else "left")
        elif abs(dy) >= SWIPE_DISTANCE and abs(dy) > abs(dx):
            self._fire(now, "swipe", dir="down" if dy > 0 else "up")

    def _fire(self, now, name, **extra):
        self.last_fired = now
        self.history = []       # 出過手勢就重新開始算，不要一個動作連發好幾次
        emit_gesture(name, **extra)

    def _oldest_within(self, now, window):
        """拿 window 秒內最舊的那筆，用來跟現在比較。"""
        for entry in self.history:
            if now - entry[0] <= window:
                return entry
        return None


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

LISTEN_SECONDS = 12.0      # 最長錄這麼久（真的講不停時的防呆上限）
SPEECH_SAMPLE_RATE = 16000

BLOCK_SECONDS = 0.1        # 每 0.1 秒看一次音量
QUIET_LEVEL = 400          # 音量（int16 RMS）低於這個值算「沒在講話」
QUIET_TO_STOP = 1.8        # 開口之後安靜這麼久，就當作講完了
LEAD_IN = 5.0              # 一開始先等這麼久，還沒想好要講什麼也不會被切掉

mic_mode = "on"        # "on" / "off" / "mock"
mock_speech_text = ""  # mock 模式：/mock_speech 設定的「假裝聽到的話」
mic_broken_warned = False  # 麥克風壞掉的訊息只印一次，不要洗畫面


def record_until_quiet(max_seconds=LISTEN_SECONDS):
    """錄音，錄到「不講話了」為止（最多 max_seconds 秒）。

    為什麼不是固定錄幾秒：台灣小孩唸注音的習慣是先一個一個唸
    （ㄋ…ㄧ…ˇ…），中間還會停下來想一下，最後才把整個音拼出來（你）。
    固定錄 4 秒常常在小孩還沒講到正確答案時就切斷了，怎麼唸都判不對。
    改成「講完自己停」最自然，小孩想拼多久都可以。

    回傳錄到的聲音（numpy int16 陣列）。
    """
    import numpy as np
    import sounddevice as sd

    block_frames = int(SPEECH_SAMPLE_RATE * BLOCK_SECONDS)
    blocks = []
    quiet_seconds = 0.0
    heard_anything = False

    with sd.InputStream(
        samplerate=SPEECH_SAMPLE_RATE, channels=1, dtype="int16", blocksize=block_frames
    ) as stream:
        for _ in range(int(max_seconds / BLOCK_SECONDS)):
            block, _overflowed = stream.read(block_frames)
            blocks.append(block.copy())

            # 這一小段有多大聲（RMS＝平均音量）
            level = float(np.sqrt(np.mean(block.astype(np.float64) ** 2)))
            if level >= QUIET_LEVEL:
                heard_anything = True
                quiet_seconds = 0.0
            else:
                quiet_seconds += BLOCK_SECONDS

            if heard_anything:
                # 已經開口了：安靜夠久就是講完了
                if quiet_seconds >= QUIET_TO_STOP:
                    break
            else:
                # 還沒開口：等過 LEAD_IN 還是一片安靜，就別再等下去
                if len(blocks) * BLOCK_SECONDS >= LEAD_IN:
                    break

    return np.concatenate(blocks) if blocks else None


def record_and_recognize(seconds=LISTEN_SECONDS):
    """錄音（講完就停）再用 Google 語音辨識轉成文字。
    這個函式會卡住（阻塞），一定要丟到背景執行緒／executor 裡跑，
    不能直接在 asyncio 的事件迴圈裡呼叫。"""
    import speech_recognition as sr

    audio = record_until_quiet(seconds)
    if audio is None:
        return None, "no_speech"

    audio_data = sr.AudioData(audio.tobytes(), SPEECH_SAMPLE_RATE, 2)

    recognizer = sr.Recognizer()
    try:
        return recognizer.recognize_google(audio_data, language="zh-TW"), None
    except sr.UnknownValueError:
        return None, "no_speech"
    except sr.RequestError as e:
        return None, f"network:{e}"


async def handle_listen(ws, seconds=LISTEN_SECONDS):
    """收到遊戲頁面的 {"type": "listen"} 時呼叫；錄音辨識完送回 heard 事件。
    seconds 是「最多錄多久」的上限，實際上小孩講完就會停。"""
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
        text, err = await loop.run_in_executor(None, record_and_recognize, seconds)
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

    tracker = GestureTracker()

    for frame in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = hands.process(rgb)

        if result.multi_hand_landmarks:
            total = 0
            for hand, handedness in zip(result.multi_hand_landmarks, result.multi_handedness):
                total += count_fingers(hand, handedness.classification[0].label)
            latest["count"] = total

            # 拿第一隻手當「游標」。手腕(0) 到中指根部(9) 的距離代表手掌
            # 大小——手往鏡頭伸過來時這個距離會變大，用它判斷「往前揮」。
            lm = result.multi_hand_landmarks[0].landmark
            palm = math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y)
            # x 左右鏡射，這樣才像照鏡子：手往右移，畫面上的游標也往右移
            hand_x = 1.0 - lm[9].x
            hand_y = lm[9].y
            latest_hand["x"] = hand_x
            latest_hand["y"] = hand_y
            tracker.update(hand_x, hand_y, palm)
        else:
            latest["count"] = None   # 沒看到手
            latest_hand["x"] = None
            latest_hand["y"] = None
            tracker.reset()

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
                    try:
                        seconds = float(data.get("seconds") or LISTEN_SECONDS)
                    except (TypeError, ValueError):
                        seconds = LISTEN_SECONDS
                    seconds = max(1.0, min(seconds, 20.0))   # 防呆，別讓網頁叫伺服器錄一小時
                    asyncio.create_task(handle_listen(ws, seconds))
    finally:
        websockets.discard(ws)
    return ws


async def mock_handler(request):
    """測試用：GET /mock?count=5 假裝看到 5 根手指；不帶 count 表示沒看到手。"""
    raw = request.query.get("count")
    latest["count"] = int(raw) if raw is not None else None
    return web.json_response({"ok": True, "count": latest["count"]})


async def mock_hand_handler(request):
    """測試用：GET /mock_hand?x=0.5&y=0.4 假裝手在畫面的這個位置；
    不帶參數表示沒看到手。"""
    raw_x = request.query.get("x")
    raw_y = request.query.get("y")
    latest_hand["x"] = float(raw_x) if raw_x is not None else None
    latest_hand["y"] = float(raw_y) if raw_y is not None else None
    return web.json_response({"ok": True, "x": latest_hand["x"], "y": latest_hand["y"]})


async def mock_gesture_handler(request):
    """測試用：GET /mock_gesture?name=push&x=0.5&y=0.4 直接送一個手勢事件；
    揮的方向用 GET /mock_gesture?name=swipe&dir=left。"""
    name = request.query.get("name", "push")
    extra = {}
    if request.query.get("dir"):
        extra["dir"] = request.query["dir"]
    for key in ("x", "y"):
        if request.query.get(key) is not None:
            extra[key] = float(request.query[key])
    emit_gesture(name, **extra)
    return web.json_response({"ok": True, "name": name, **extra})


async def switchbot_log_handler(request):
    """測試用：查 mock 模式下 SwitchBot 被觸發了幾次。"""
    return web.json_response({"count": len(switchbot_log)})


async def stickers_get_handler(request):
    """網頁開起來時來拿最新的收集簿。"""
    return web.json_response(load_sticker_book())


async def stickers_apply_handler(request):
    """網頁送一筆變更過來（得到貼紙／花掉／贏獎品／換錢／獎盃）。"""
    try:
        action = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="需要 JSON")

    book = apply_sticker_action(load_sticker_book(), action)
    save_sticker_book(book)
    return web.json_response(book)


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
    last_hand = "?"          # 上次送出去的手掌位置
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

        # 手掌位置：位置有變才送（一直不動就不用重複送）
        hand = (latest_hand["x"], latest_hand["y"])
        if hand != last_hand:
            events.append({
                "type": "hand",
                "x": round(hand[0], 3) if hand[0] is not None else None,
                "y": round(hand[1], 3) if hand[1] is not None else None,
            })
            last_hand = hand

        # 視覺執行緒偵測到的手勢，原封不動轉給遊戲頁面
        events.extend(take_gestures())

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
        print(
            "🧪 mock 模式：用 GET /mock?count=N 假裝手指數、"
            "/mock_hand?x=&y= 假裝手的位置、/mock_gesture?name=push 假裝手勢"
        )

    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/mock", mock_handler)
    app.router.add_get("/mock_hand", mock_hand_handler)
    app.router.add_get("/mock_gesture", mock_gesture_handler)
    app.router.add_get("/switchbot/log", switchbot_log_handler)
    app.router.add_get("/mock_speech", mock_speech_handler)
    app.router.add_get("/stickers", stickers_get_handler)
    app.router.add_post("/stickers/apply", stickers_apply_handler)
    app.router.add_get("/{tail:.*}", static_handler)
    app.on_startup.append(start_background)

    print_welcome(args.source)
    web.run_app(app, port=PORT, print=None)


if __name__ == "__main__":
    main()
