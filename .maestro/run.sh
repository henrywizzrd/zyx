#!/usr/bin/env bash
# Chạy trên máy ảo Android (GitHub Actions): cài APK, cho app tải bản cập nhật mới nhất (OTA), chạy kịch bản,
# rồi gom ảnh chụp, video, số liệu khung hình (gfxinfo) và nhật ký (logcat) vào ui-out/
set -x
PKG=com.henrywizzrd.zyx
OUT="$PWD/ui-out"
mkdir -p "$OUT"
adb install -r apk/Zyx.apk
# 2 lần mở: lần 1 tải bản cập nhật, lần 2 chạy bản đó
for i in 1 2; do
  adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1
  sleep 35
  adb exec-out screencap -p > "$OUT/boot-$i.png"
  adb shell am force-stop $PKG
  sleep 2
done
adb logcat -c
adb shell dumpsys gfxinfo $PKG reset > /dev/null
export PATH="$PATH:$HOME/.maestro/bin"
cd "$OUT"
maestro test "$GITHUB_WORKSPACE/.maestro/flow.yaml" --test-output-dir "$OUT/maestro" > "$OUT/maestro.txt" 2>&1 || echo "Kịch bản dừng giữa chừng (xem maestro.txt)" > "$OUT/FLOW_FAILED.txt"
adb exec-out screencap -p > "$OUT/final.png"
adb shell dumpsys gfxinfo $PKG > "$OUT/gfxinfo.txt"
adb logcat -d -v time ReactNativeJS:V AndroidRuntime:E '*:S' > "$OUT/logcat.txt"
grep "\[zyx\]\[motion\]" "$OUT/logcat.txt" > "$OUT/motion.txt" || true
exit 0
