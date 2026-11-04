# 仓库结构分类清单

**基准**：`PanYQ136/gods-eye-pro` · `main` · commit `75158fe`
**规模**：跟踪文件 6004 个；顶层条目 45 个（13 个目录 + 32 个根级文件）
**分类维度**：条目在工程中承担的职责（单一维度）。六个类别互斥，命名统一为「XX 类」；条目名称原样保留，不改名、不增删、不移动文件。

---

## 1. 分类清单

### 1.1 源码类（4 个条目 · 1370 个文件）

> 应用运行时代码与构建期代码。

- 目录：`src/`、`server/`、`api/`、`build/`
- 根级文件：无

### 1.2 配置类（14 个条目 · 21 个文件）

> 构建、格式化、依赖、部署与仓库行为配置。

- 目录：`.agents/`、`.github/`、`config/`
- 根级文件：`.env.example`、`.git-blame-ignore-revs`、`.gitattributes`、`.gitignore`、`.prettierignore`、`.prettierrc.json`、`.vercelignore`、`package.json`、`package-lock.json`、`vite.config.js`、`vercel.json`

### 1.3 资源类（3 个条目 · 67 个文件）

> 浏览器直接加载的静态资源与页面入口。

- 目录：`public/`
- 根级文件：`index.html`、`style.css`

### 1.4 文档类（12 个条目 · 3695 个文件）

> 说明、规范、进度、许可，以及随文档归档的验收截图与附件。

- 目录：`docs/`
- 根级文件：`AGENTS.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`DATA_SOURCES.md`、`FPS优化方法.md`、`LICENSE`、`PROGRESS.md`、`README.md`、`SECURITY.md`、`TESTING.md`、`THIRD_PARTY_NOTICES.md`

### 1.5 脚本类（10 个条目 · 815 个文件）

> 开发、验收、部署与安装的辅助可执行脚本。

- 目录：`scripts/`、`tools/`、`pinokio/`
- 根级文件：`_probe_bridge.mjs`、`_probe_routes.mjs`、`guard_backend.ps1`、`start-dev.cmd`、`start-prod.cmd`、`start-tunnel.cmd`、`start_gods_eye_hidden.vbs`

### 1.6 产物类（2 个条目 · 36 个文件）

> 运行或验收过程生成的输出与日志。

- 目录：`out-qa/`
- 根级文件：`vite.err`

### 1.7 覆盖校验

| 类别 | 顶层条目数 | 文件数 |
| --- | ---: | ---: |
| 源码类 | 4 | 1370 |
| 配置类 | 14 | 21 |
| 资源类 | 3 | 67 |
| 文档类 | 12 | 3695 |
| 脚本类 | 10 | 815 |
| 产物类 | 2 | 36 |
| **合计** | **45** | **6004** |

顶层条目 45/45、文件 6004/6004，每个条目只出现一次，未分类文件 0 个，无「其它」兜底类。
`.agents/` 在 GitHub 页面上折叠显示为 `.agents/skills/community-pr`，本清单按仓库真实顶层条目名书写。

---

## 2. 目录结构概览

```
gods-eye-pro/                          （45 个顶层条目）
│
├─ 源码类 ────────────────────────────────────────────────
│  ├─ src/          1267   layers/354 · data/303 · ui/166 · app/58
│  │                       voice/33 · sources/29 · director/25 · tooling/22
│  │                       scenes/21 · annotations/17 · lc/17 · maps/17 · search/15 …
│  ├─ server/         99   providers/93（本地数据代理中间件）
│  ├─ api/             1   Vercel 桥接入口
│  └─ build/           3   构建期模型处理
│
├─ 配置类 ────────────────────────────────────────────────
│  ├─ .github/         5   workflows/ · ISSUE_TEMPLATE/ · CODEOWNERS
│  ├─ config/          4   CCTV 数据源配置
│  ├─ .agents/         1   协作技能定义
│  └─ 根级 11 个        .gitignore / .gitattributes / .prettierrc.json /
│                        package.json / package-lock.json / vite.config.js /
│                        vercel.json / .env.example / .vercelignore 等
│
├─ 资源类 ────────────────────────────────────────────────
│  ├─ public/         65   models/37 · vessel-photos/7 · events/4 · data/3 …
│  └─ 根级 2 个         index.html · style.css
│
├─ 文档类 ────────────────────────────────────────────────
│  ├─ docs/         3684   lg-glass-shots/2717 · _collab/899 · media/20
│  │                       architecture/10 · mobile-shots/7 · 根级文档
│  └─ 根级 11 个        README.md · AGENTS.md · PROGRESS.md · CHANGELOG.md …
│
├─ 脚本类 ────────────────────────────────────────────────
│  ├─ scripts/       793   lc/310 · _archive/125 · fixtures/2 · 根级脚本 356
│  ├─ tools/           8   辅助工具
│  ├─ pinokio/         7   安装 / 启动 / 更新脚本
│  └─ 根级 7 个         _probe_*.mjs · guard_backend.ps1 · start-*.cmd · *.vbs
│
└─ 产物类 ────────────────────────────────────────────────
   ├─ out-qa/         35   验收输出 JSON
   └─ 根级 1 个        vite.err
```

---

## 3. 相比上一版的主要调整

1. **分类对象统一**：上一版以叶子文件为单位，把 `docs/` 内部子目录拆到多个类别，导致同一目录跨类、边界重叠。本版统一以**顶层条目**为最小单位，`docs/` 整体只进文档类一次。
2. **维度统一**：上一版混用用途、文件类型、状态、部署方式四种维度（例如「验收证据与历史快照」按状态、「部署与云函数」按部署方式）。本版只保留「条目职责」单一维度。
3. **命名一致**：上一版 9 类名称长短结构不一；本版统一为「XX 类」六类，取消含糊的「其它」类。
4. **归属校正**：`api/`、`build/` 归回源码类；`vite.config.js`、`vercel.json` 统一进配置类；`out-qa/`、`vite.err` 单列产物类；`AGENTS.md`（规范文档）与 `.agents/`（技能配置）按各自职责分开，不因名称相近合并。
5. **双重校验**：顶层条目 45/45、叶子文件 6004/6004，均无重复、无遗漏、无未分类项。
