#!/usr/bin/env python3
"""掃描附近的藍牙裝置，幫忙找出 SwitchBot 的 MAC 位址。

用法：
  python3 scan_switchbot.py

會列出附近所有 BLE 裝置的名稱和 MAC 位址；SwitchBot Bot 通常
名稱裡會有「WoHand」或「SwitchBot」字樣。找到的 MAC 位址
（長得像 AA:BB:CC:DD:EE:FF）就是 vision_server.py 的 --switchbot 參數。
"""

import asyncio

from bleak import BleakScanner


async def scan():
    print("掃描中（10 秒）……請確認 SwitchBot 在附近，且手機 App 已經關閉（避免搶連線）")
    devices = await BleakScanner.discover(timeout=10.0)

    if not devices:
        print("沒有掃到任何藍牙裝置，確認藍牙有打開、SwitchBot 電量足夠再試一次。")
        return

    print(f"\n找到 {len(devices)} 個裝置：\n")
    for d in devices:
        name = d.name or "(沒有名字)"
        hint = "  👈 看起來像 SwitchBot！" if d.name and ("switchbot" in d.name.lower() or "wohand" in d.name.lower()) else ""
        print(f"  {d.address}   {name}{hint}")

    print("\n找到 SwitchBot 的 MAC 位址後，這樣啟動：")
    print("  ./start.sh --switchbot AA:BB:CC:DD:EE:FF")


if __name__ == "__main__":
    asyncio.run(scan())
