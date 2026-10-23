#!/bin/bash
# 用命令列工具編譯並包成 EnglishCoach.app（不需要 Xcode）
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release

APP="build/EnglishCoach.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/EnglishCoach "$APP/Contents/MacOS/EnglishCoach"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>EnglishCoach</string>
  <key>CFBundleIdentifier</key><string>local.englishcoach</string>
  <key>CFBundleExecutable</key><string>EnglishCoach</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP"
echo ""
echo "完成：$(pwd)/$APP"
echo "執行：open $APP"
