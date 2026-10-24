# 上帝之眼 · natfrp 内网穿透外网节点实测清单

> 日期：2026-10-24 · 账户 Swift136 (id 1088784) · 加密钥(不落明文) · frpc 0.51.0-sakura-15.1
> 目标：把本机 4173 网页经 natfrp 暴露公网，供手机外网访问。

## 一、当前投入使用（PROD + 走代理，最稳配置）
- **日本1 节点** | 域名 `frp-fly.com` | IP `202.182.125.24` | 远程端口 `11269`
- 访问：`http://frp-fly.com:11269/`  备用 `http://202.182.125.24:11269/`
- 隧道 `gevprod` id=29654099 node=72 online=true（**local 4174 = PROD 打包 dist**，非 dev 4173）
- **frpc 走 Clash 代理出网**（`ALL_PROXY=127.0.0.1:7890`）——这是关键：直连日本时数据端口 :8088 会 `i/o timeout`（命中率仅~4/6）；走 Clash 国际出口后 **页面 8/8 全 200、无拨号超时、延迟 0.6–1.9s**。
- 实测：health = layers28 / channels41 / **down0** / okChannels36-38；大文件（主 bundle 2.6MB）仍约 1/3 截断，靠浏览器 gzip+重试兜底；小接口 100%。
- 自启：`GodsEye_natfrp_frpc`(登录→`start_frpc.vbs`→`run_frpc_proxy.cmd`) + `GodsEye_ProdServer`(登录→`start_prod.vbs`→`start-prod.cmd` 起 4174) + `GodsEye_WebAtBoot`(开机 4173 dev)。

## 二、节点轮换实测结果（2026-10-24）
| 节点 | 名称 | 域名 | 类别 | 结果 |
|---|---|---|---|---|
| 2 | 天津联通PLUS1 | frp-act.com | 内地 | ❌ HTTP 返回 **501**（内地节点禁止 HTTP-over-TCP）|
| 68 | 福建三线PLUS1 | frp-hat.com | 内地 | ❌ 创建返回 **403 已暂停添加隧道** |
| 16 | 中国台湾CHT1 | frp-few.com | 非内地 | ❌ 连接 40s 未建立（不可用）|
| **72** | **日本1** | **frp-fly.com** | 非内地 | ✅ **可用**（当前主用，中日直连大文件偶截断）|
| 74 | 日本2 | frp-cup.com | 非内地 | ⚠️ 部分可用（full 2/6，health 3/3，波动大）|
| 80 | 韩国1 | frp-air.com | 非内地 | ⚠️ 测出 502/不稳 |
| 73 | 新加坡1 | frp-can.com | 非内地 | ⚠️ 测出 502/不稳 |
| 17 | 越南1 | frp-aim.com | 非内地 | ⚠️ 测出 502/不稳 |

## 三、关键技术结论（重要）
1. **内地节点禁 HTTP-over-TCP**：natfrp 规定 TCP 隧道穿透 HTTP 应用必须用非内地节点；内地节点返回 501。
2. **非内地节点中日直连有丢包**：本机 `tun.enable=false`（ClashMi 仅系统代理，frpc 直连日本），中国→日本国际链路对大响应（>50KB）约 **1/3 截断**。小接口/health 不受影响。
3. 浏览器自带 gzip + 重试可覆盖截断（9/9 最终成功），但每次截断触发超时重试 → **慢**。
4. **迁移(migrate)有 2 分钟冷却**，轮换节点用"建-测-删"更合适（非内地节点可用，内地不可用）。

## 四、节点切换方法（备用节点启用步骤）
```bash
T=<访问密钥>; API=https://api.natfrp.com/v4
# 1) 建隧道(换 node 号)
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
 -d '{"name":"gevweb2","type":"tcp","node":74,"local_ip":"127.0.0.1","local_port":4173,"remote_port":0}' \
 $API/tunnels     # 返回 id 和 remote
# 2) 改 start_frpc.vbs 里 token:隧道ID 为新 id
# 3) 重启 frpc: taskkill /IM frpc.exe /F  然后运行 start_frpc.vbs
```
- 备选：日本2 fpr-cup.com（同日本，波动），或监控到日本1异常时切日本2。
- 内地节点(如福建)即使 ping 再快，HTTP 会被 501，不能用。

## 五、若要"真正稳定+快"的后续方案
1. **改 PROD 构建指向隧道**：vite dev(4173) 会发起数百个小模块请求，丢包链路上往返极多 → 慢。用 `npm run build` 的 dist(4174) 打包后请求数骤减，隧道下明显更顺。
2. **国内 HTTP 穿透服务**（花生壳/神卓/贝锐等，需备案域名）：走国内中转，天然稳定低延迟，是大陆访问重型网页最稳的路子；但需注册+域名备案。
3. 或接受日本节点"能开但慢"，仅作偶尔查看。

## 六、frpc 相关文件
- 可执行：`D:\Hermes\natfrp\frpc.exe`（v0.51.0-sakura-15.1）
- 常驻启动：`D:\Hermes\natfrp\start_frpc.vbs`（由计划任务 `GodsEye_natfrp_frpc` 登录时调用）
- 日志：`D:\Hermes\natfrp\frpc.out.log`
- 密钥不写入本文件；隧道 ID 见第一节。
