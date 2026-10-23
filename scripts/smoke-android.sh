#!/usr/bin/env bash
# Дымовой тест на эмуляторе: AVD cvg без окна, APK со сборкой VITE_TEST_KNOBS=1, фейковый claude на сервере tmux cvg-smoke.
#   npm run test:smoke
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/android-env.sh
PKG=io.github.liotto1337.claudevm

# SMOKE_SKIP_BUILD=1 — APK уже собран со сборкой VITE_TEST_KNOBS=1
[ "${SMOKE_SKIP_BUILD:-}" = 1 ] || VITE_TEST_KNOBS=1 npm run android:build
# Демон Gradle занимает память, которой эмулятору на этой ВМ не хватает
(cd android && ./gradlew --stop >/dev/null 2>&1) || true

if ! adb get-state >/dev/null 2>&1; then
  nohup emulator -avd cvg -no-window -no-audio -gpu swiftshader_indirect -memory 2048 -cores 2 -no-snapshot -no-boot-anim >/tmp/cvg-emulator.log 2>&1 &
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 5; done
  sleep 20
fi
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm clear "$PKG" >/dev/null
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 0

# Фейковый claude с журналом — в отдельном сервере tmux, настоящие сессии не трогаются
export CVG_SMOKE_CLAUDE_DIR
CVG_SMOKE_CLAUDE_DIR=$(mktemp -d)
tmux -L cvg-smoke kill-server 2>/dev/null || true
tmux -L cvg-smoke new-session -d -s cvg-smoke-claude -x 60 -y 40 "CVG_CLAUDE_DIR=$CVG_SMOKE_CLAUDE_DIR node $PWD/tests/fixtures/fake-claude.mjs"
# Вторая сессия — без отметки «Отслеживать»: уведомлений от неё быть не должно
tmux -L cvg-smoke new-session -d -s cvg-smoke-other -x 60 -y 40 "CVG_CLAUDE_DIR=$CVG_SMOKE_CLAUDE_DIR node $PWD/tests/fixtures/fake-claude.mjs"
trap 'tmux -L cvg-smoke kill-server 2>/dev/null || true' EXIT

npx playwright test -c playwright.android.config.ts
