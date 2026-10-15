#!/bin/bash
# AweSun (向日葵 / Oray) 完整卸载脚本
# 由 DSH 生成：删除虚拟声卡驱动、守护进程、主程序、日志、收据、用户配置
set -u

USER_NAME="dingyuebo"
USER_HOME="/Users/${USER_NAME}"
USER_UID_NUM="$(id -u "${USER_NAME}")"

step() { echo; echo "===== $* ====="; }
ok()   { echo "  [ok] $*"; }
gone() { echo "  [已删除] $*"; }

echo "###### AweSun 卸载开始 ######"

step "1. 停止并注销 launchd 服务"
for label in com.oray.awesun.service com.oray.awesun.helper \
             com.oray.awesun.desktopagent com.oray.awesun.client.startup; do
  launchctl bootout "system/${label}" 2>/dev/null && ok "bootout system/${label}"
  launchctl bootout "gui/${USER_UID_NUM}/${label}" 2>/dev/null && ok "bootout gui/${label}"
  launchctl remove "${label}" 2>/dev/null && ok "remove ${label}"
done
ok "launchd 服务注销流程完成"

step "2. 结束残留进程"
for pat in "/Applications/AweSun.app" "AweSun"; do
  if pkill -f "${pat}" 2>/dev/null; then ok "已结束匹配进程: ${pat}"; fi
done
sleep 1
ok "进程清理完成"

step "3. 删除 LaunchAgents 与 LaunchDaemons"
for f in /Library/LaunchAgents/com.oray.awesun.agent.plist \
         /Library/LaunchAgents/com.oray.awesun.startup.plist \
         /Library/LaunchDaemons/com.oray.awesun.helper.plist \
         /Library/LaunchDaemons/com.oray.awesun.plist; do
  if [ -e "${f}" ]; then
    rm -f "${f}" && gone "${f}"
  else
    echo "  [跳过] 不存在: ${f}"
  fi
done

step "4. 删除虚拟声卡驱动 OrayVirtualAudioDevice.driver"
D="/Library/Audio/Plug-Ins/HAL/OrayVirtualAudioDevice.driver"
if [ -e "${D}" ]; then
  rm -rf "${D}" && gone "${D}"
else
  echo "  [跳过] 不存在: ${D}"
fi
echo "  HAL 目录现状:"
ls -la /Library/Audio/Plug-Ins/HAL/

step "5. 删除主程序 /Applications/AweSun.app"
A="/Applications/AweSun.app"
if [ -e "${A}" ]; then
  rm -rf "${A}" && gone "${A}"
else
  echo "  [跳过] 不存在: ${A}"
fi

step "6. 删除日志目录"
L="/var/log/AweSun"
if [ -e "${L}" ]; then
  rm -rf "${L}" && gone "${L}"
else
  echo "  [跳过] 不存在: ${L}"
fi

step "7. 忘记安装包收据 (pkgutil --forget)"
for r in com.oray.sunlogin.MacVirtualAudioDevice com.oray.sunlogin.macclient; do
  if [ -e "/var/db/receipts/${r}.plist" ]; then
    pkgutil --forget "${r}" && gone "收据 ${r}"
  else
    echo "  [跳过] 无收据: ${r}"
  fi
done

step "8. 删除用户级配置与缓存"
for p in \
  "${USER_HOME}/Library/Application Support/AweSun" \
  "${USER_HOME}/Library/Application Support/com.oray.sunlogin.macclient" \
  "${USER_HOME}/Library/Application Support/CrashReporter/AweSun_12678C06-610A-568E-AB8A-54BA072257F2.plist" \
  "${USER_HOME}/Library/WebKit/com.oray.sunlogin.macclient" \
  "${USER_HOME}/Library/Preferences/com.oray.sunlogin.macclient.plist" \
  "${USER_HOME}/Library/HTTPStorages/com.oray.sunlogin.macclient.binarycookies" \
  "${USER_HOME}/Library/Caches/com.oray.sunlogin.macclient" \
  "${USER_HOME}/Library/Saved Application State/com.oray.sunlogin.macclient.savedState" \
  "${USER_HOME}/Library/Logs/AweSun" ; do
  if [ -e "${p}" ]; then
    rm -rf "${p}" && gone "${p}"
  else
    echo "  [跳过] 不存在: ${p}"
  fi
done

step "9. 重启 CoreAudio 服务（卸载虚拟声卡生效）"
killall coreaudiod 2>/dev/null && ok "coreaudiod 已重启" || echo "  [提示] coreaudiod 未在运行或已自动重启"

step "10. 卸载后校验"
echo "--- HAL 目录 ---";      ls -la /Library/Audio/Plug-Ins/HAL/
echo "--- AweSun App ---";     ls -d /Applications/AweSun.app 2>&1
echo "--- LaunchAgents ---";   ls /Library/LaunchAgents/ 2>/dev/null | grep -i oray || echo "  无 oray 残留"
echo "--- LaunchDaemons ---";  ls /Library/LaunchDaemons/ 2>/dev/null | grep -i oray || echo "  无 oray 残留"
echo "--- receipts ---";       ls /var/db/receipts/ 2>/dev/null | grep -i -E "oray|awesun" || echo "  无 oray 残留"
echo "--- 全盘复查 ---";       find /Library /var/log /Applications -maxdepth 4 -iname "*oray*" -o -maxdepth 4 -iname "*awesun*" 2>/dev/null || true
echo
echo "###### 卸载流程结束 ######"