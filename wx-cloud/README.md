# gods-eye 微信云函数代理（开发 / 上线同一套）

小程序在正式版里访问外部数据必须走 HTTPS + 已 ICP 备案的 `request 合法域名`，而家里 gods-eye 的 4173 是 http/未备案。**本云函数解决这个问题**：

```
小程序 wx.cloud.callFunction('godsEyeProxy')
      → 微信云函数（不校验域名白名单，可用任意后端）
      → HTTPS/HTTP 反代到你家的 gods-eye:4173（经睿易内网穿透域名）
      → provider 从家宽 IP 抓上游（OpenSky 等排斥云 IP 的源也正常）
```

优点：小程序端**开发版 / 正式版用同一套代码**，正式版也**不用备案域名、不用证书**。

## 目录
```
wx-cloud/
├─ cloudfunctions/godsEyeProxy/
│  ├─ index.js        # 云函数主体：按 path 反代到 GEV_BASE
│  └─ package.json    # 无第三方依赖，用 node 内置 http/https
├─ miniprogram/geoCli.js   # 小程序端调用助手
└─ README.md
```

## 部署步骤
1. 微信开发者工具打开你的小程序项目 → 顶部「云开发」→ 开通 → 记下**环境 ID**。
2. 把 `cloudfunctions/godsEyeProxy` 整个文件夹复制到你项目的 `cloudfunctions/` 目录下。
3. 右键 `godsEyeProxy` → **上传并部署：云端安装依赖**。
4. 云开发控制台 → 云函数 → `godsEyeProxy` → 配置：
   - **环境变量** 新增：`GEV_BASE` = 睿易内网穿透给你的地址，例如 `http://abcd1234.reyee.xxx:12345`
     （即你在「睿易 App → 内网穿透 → 应用端口 4173」那条生成的域名:端口）
   - **超时时间** 调到 **20~60 秒**（抓上游可能慢）
5. 小程序 `app.js` 里：`wx.cloud.init({ env: '你的环境ID', traceUser: true })`

## 小程序端调用
```js
const { geoCli } = require('../../utils/geoCli');

const cyclones = await geoCli('cyclones');                 // 台风
const quakes   = await geoCli('cn/quakes');                // 地震
const typhoon  = await geoCli('cn/typhoon');               // 台风(国内源)
const flights  = await geoCli('opensky', { bbox: '110,20,125,35' }); // 航班
const traffic  = await geoCli('cn/traffic', { bbox: '110,20,125,35' });
const cctv     = await geoCli('cctv');
```

也可直接：
```js
wx.cloud.callFunction({ name:'godsEyeProxy', data:{ path:'/api/cyclones' } })
  .then(res => console.log(res.result.data));
```

## 支持的接口（= gods-eye 的 /api/*）
`/api/opensky`、`/api/cyclones`、`/api/cn/quakes`、`/api/cn/typhoon`、`/api/cn/traffic`、`/api/cn/weather`、`/api/cctv`、`/api/earthquakes`、`/api/adsblol/mil`、`/api/adsbdb`、`/api/aircraft-photo`、`/api/opensky-track` 等（以 gods-eye 实际注册为准）。

## 注意
- **数据源仍是你电脑**：电脑要开机、`vite --host 0.0.0.0 --port 4173` 在跑、睿易穿透开着；否则云函数会返回 `{ok:false, hint:...}`。
- 单次返回很大（如全量航班）可能触达云函数返回大小上限；如遇大payload，可让 provider 端先裁剪/分页。
- 想彻底不依赖电脑，需要把抓取逻辑直接搬进云函数（但 OpenSky 会因云 IP 被封，除非改走别的源）——按需后续再做。
