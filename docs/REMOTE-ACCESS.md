# 外网访问 / 内网穿透（Web 版上帝之眼）

## 现状（2026-10-24）

- **生产外网端点已就绪**：`start-prod.cmd`（vite preview，`0.0.0.0:4174`）服务 `dist/` 生产构建 + 全部 `/api` provider 中间件（每个 provider 实现了 `configurePreviewServer`）。已验证 `/`、`/api/cyclones`、`/api/sources/health` 正常，`127.0.0.1:4174` 与局域网 `192.168.110.126:4174` 均可达。
- **穿透方式 = Tailscale**（节点 `desktop-godseye`，IP `100.93.210.120`；LAN `192.168.110.126`）。Cloudflare Tunnel 已弃用（大陆被墙 + cloudflared 不走代理）。
- **当前阻塞**：本次 **Win11 就地升级（29683）后 Tailscale 卡 `NoState`**（`/c/ProgramData/Tailscale` 下 tailscaled 日志 0 字节、服务方式启动即崩；前台 tailscaled 能初始化但 CLI 连不上）。外网 `100.x:417x` → 000，LAN → 200。这是历史复发故障（见 `PROGRESS.md` 2026-10-20 条目），恢复终点是 `NeedsLogin`，需账号 SSO 授权（无法代填）。

## 恢复 Tailscale（二选一）

### A. 优先：重启系统（服务方式卡死需重启恢复 LocalSystem 服务的 TPM/会话）
```
# 重启后：
tailscale status          # 应为 NeedsLogin 或 Running
tailscale up              # 若 NeedsLogin → 浏览器打开授权链接，账号 SSO 授权一次
tailscale ip -4           # 核对是否仍 100.93.210.120
```
> 重启会短暂中断 qqbot/weixin/photon/gateway（约 2–3 分钟）；恢复后自动拉起网关，桥接如未自启需重启对应 sidecar。

### B. 不重启：先尝试文档化步骤到 NeedsLogin
```
Stop-Service Tailscale
# 精准杀残留（勿 taskkill /im）
Get-CimInstance Win32_Process -Filter "Name='tailscaled.exe'" | %{ Stop-Process -Id $_.ProcessId -Force }
# 备份状态
copy C:\ProgramData\Tailscale\server-state.conf  C:\ProgramData\Tailscale\server-state.conf.bak-<date>
Start-Service Tailscale
tailscale up
```
若仍 `NoState` → 走 A（重启）。

## 开启外网入口（Tailscale 恢复后）

```
# 生产端（dist + 全 /api）
start-prod.cmd
# 一键挂 tailnet HTTPS（或直接 http://100.93.210.120:4174/）
start-tunnel.cmd
# 需公网（任意设备无 Tailscale，且 tailnet 开启 Funnel）：
tailscale funnel --bg 4174
```

## 为何穿透后功能完整

- 前端对后端全部走**同源相对 `/api/*`**（非绝对域名），穿透只是换访问入口，地图图层、数据源自动降级切换、GPU 风场流线、交互逻辑与直连时**完全一致**。
- 生产预览复用同一套 provider 中间件与代理/NO_PROXY env，服务端上游取数行为与 dev 相同（`down 0`）。
- 若走 `tailscale serve` 的 HTTPS：HMR 无（生产构建），无 dev 覆盖层与性能开销，更接近真机生产体验。
