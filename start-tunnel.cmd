@echo off
chcp 65001 >nul
title God's Eye View - Tailscale external access
setlocal
REM 前置：Tailscale 必须 Running（tailscale status 显示节点，非 NoState/NeedsLogin）。
REM 生产端已在 0.0.0.0:4174 提供服务；本脚本把 tailnet / 公网 HTTPS 反代到它。
where tailscale >nul 2>&1 || (echo [ERR] tailscale 未安装 & exit /b 1)
tailscale status 2>&1 | findstr /I "NoState NeedsLogin Stopped" >nul && (
  echo [ERR] Tailscale 未运行^(NoState/NeedsLogin^)。
  echo       先恢复：见 skill gods-eye-view §8；若服务方式卡 NoState 需重启系统 + SSO 授权。
  exit /b 1
)
echo [1/2] tailscale serve ^(tailnet 内 HTTPS -^> localhost:4174^) ...
tailscale serve --bg 4174
echo.
echo [info] tailnet 内访问： https://<节点名>.<tailnet>.ts.net/   或  http://100.93.210.120:4174/
echo [info] 若需公网^(任意设备无Tailscale^)且 tailnet 已开启 Funnel：
echo          tailscale funnel --bg 4174
echo.
tailscale serve status
endlocal
