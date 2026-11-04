# 仓库结构分类清单

**基准**：`PanYQ136/gods-eye-pro` · `main`（目录重组执行后）
**规模**：跟踪文件 5969 个；顶层条目 44 个（13 个目录 + 31 个根级文件）
**分类维度**：条目在工程中承担的职责（单一维度）。六个类别互斥，命名统一为「XX 类」；条目名称原样保留，不改名、不增删。

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

### 1.4 文档类（12 个条目 · 73 个文件）

> 说明、规范、进度与许可，以及工程文档附件。

- 目录：`docs/`（62 个文件）
- 根级文件：`AGENTS.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`DATA_SOURCES.md`、`FPS优化方法.md`、`LICENSE`、`PROGRESS.md`、`README.md`、`SECURITY.md`、`TESTING.md`、`THIRD_PARTY_NOTICES.md`

### 1.5 脚本类（10 个条目 · 815 个文件）

> 开发、验收、部署与安装的辅助可执行脚本。

- 目录：`scripts/`、`tools/`、`pinokio/`
- 根级文件：`_probe_bridge.mjs`、`_probe_routes.mjs`、`guard_backend.ps1`、`start-dev.cmd`、`start-prod.cmd`、`start-tunnel.cmd`、`start_gods_eye_hidden.vbs`

### 1.6 产物类（1 个条目 · 3623 个文件）

> 验收过程产生的截图、协作快照与历史证据，集中存放以划清与工程文档的边界。

- 目录：`evidence/`（`lg-glass-shots/` 2717、`_collab/` 899、`mobile-shots/` 7）
- 根级文件：无

### 1.7 覆盖校验

| 类别 | 顶层条目数 | 文件数 |
| --- | ---: | ---: |
| 源码类 | 4 | 1370 |
| 配置类 | 14 | 21 |
| 资源类 | 3 | 67 |
| 文档类 | 12 | 73 |
| 脚本类 | 10 | 815 |
| 产物类 | 1 | 3623 |
| **合计** | **44** | **5969** |

顶层条目 44/44、文件 5969/5969，每个条目只出现一次，未分类文件 0 个，无「其它」兜底类。
`out-qa/` 与 `vite.err` 属于运行/验收生成物，已移出版本库（本地保留并加入忽略规则），因此不再是仓库顶层条目。

---

## 2. 目录结构概览

```
gods-eye-pro/                          （44 个顶层条目）
│
├─ 源码类 ────────────────────────────────────────────────
│  ├─ src/          1267   layers/354 · data/303 · ui/166 · app/58
│  │                       voice/33 · sources/29 · director/25 · tooling/22
│  ├─ server/         99   providers/93（本地数据代理中间件）
│  ├─ api/             1   Vercel 桥接入口
│  └─ build/           3   构建期模型处理
│
├─ 配置类 ────────────────────────────────────────────────
│  ├─ .github/         5   workflows/ · ISSUE_TEMPLATE/ · CODEOWNERS
│  ├─ config/          4   CCTV 数据源配置
│  ├─ .agents/         1   协作技能定义
│  └─ 根级 11 个        .gitignore / .gitattributes / .prettierrc.json /
│                        package.json / vite.config.js / vercel.json 等
│
├─ 资源类 ────────────────────────────────────────────────
│  ├─ public/         65   models/37 · vessel-photos/7 · events/4 · data/3 …
│  └─ 根级 2 个         index.html · style.css
│
├─ 文档类 ────────────────────────────────────────────────
│  ├─ docs/           62   工程文档、架构说明、验收报告与文档附件
│  └─ 根级 11 个        README.md · AGENTS.md · PROGRESS.md · CHANGELOG.md …
│
├─ 脚本类 ────────────────────────────────────────────────
│  ├─ scripts/       793   lc/310 · _archive/125 · fixtures/2 · 根级脚本 356
│  ├─ tools/           8   辅助工具
│  ├─ pinokio/         7   安装 / 启动 / 更新脚本
│  └─ 根级 7 个         _probe_*.mjs · guard_backend.ps1 · start-*.cmd · *.vbs
│
└─ 产物类 ────────────────────────────────────────────────
   └─ evidence/     3623   lg-glass-shots/2717 · _collab/899 · mobile-shots/7
```

---

## 3. 本次目录重组

1. **证据域独立**：`docs/lg-glass-shots/`、`docs/_collab/`、`docs/mobile-shots/` 移入顶层 `evidence/`，共 3623 个文件以 rename 方式迁移；`docs/` 从 3684 个文件收敛到 62 个纯工程文档，文档与验收证据边界清晰。
2. **引用同步**：全仓 118 个文件中的 197 处路径引用由 `docs/<证据目录>` 批量改为 `evidence/<证据目录>`，替换后旧路径残留 0 处。
3. **产物出库**：`out-qa/`（35 个验收 JSON）与 `vite.err`（运行日志）从版本库移出，本地保留并加入忽略规则；顶层条目由 45 变为 44。
4. **保持原位**：`src/`、`server/`、`api/`、`build/`、`public/`、`.github/`、`config/`、`.agents/`、`scripts/`、`tools/`、`pinokio/` 均按原模块结构保留；根级 11 份文档与 7 个启动/探针脚本因平台约定（README/LICENSE/AGENTS/CONTRIBUTING/SECURITY）与相对路径、任务计划依赖，保持根目录原位，未移动。
5. **未执行**：`scripts/` 根级 356 个脚本的二级分组需要逐个判定用途，且 `scripts/lc/` 有 143 处路径引用，本次未做，以免误判。
6. **双重校验**：顶层条目 44/44、叶子文件 5969/5969，均无重复、无遗漏、无未分类项。
