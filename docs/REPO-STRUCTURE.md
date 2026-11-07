# 仓库结构分类清单

**基准**：`PanYQ136/God-s-Eye-View-zh` · `main`（上游 2489 提交合并后重测，2026-11-07）
**规模**：跟踪文件 3432 个；顶层条目 48 个（11 个目录 + 37 个根级文件）
**分类维度**：条目在工程中承担的职责（单一维度）。六个类别互斥，命名统一为「XX 类」；条目名称原样保留，不改名、不增删。

---

## 1. 分类清单

### 1.1 源码类（4 个条目 · 2633 个文件）

> 应用运行时代码与构建期代码。

- 目录：`src/`（2485）、`server/`（139）、`build/`（8）、`api/`（1）
- 根级文件：无

### 1.2 配置类（18 个条目 · 27 个文件）

> 构建、格式化、依赖、部署与仓库行为配置。

- 目录：`.github/`（6）、`config/`（4）、`.vercel/`（2）、`.agents/`（1）
- 根级文件（14 个）：`.dockerignore`、`.env.example`、`.git-blame-ignore-revs`、`.gitattributes`、`.gitignore`、`.prettierignore`、`.prettierrc.json`、`.vercelignore`、`compose.yaml`、`Dockerfile`、`package-lock.json`、`package.json`、`vercel.json`、`vite.config.js`

### 1.3 资源类（3 个条目 · 73 个文件）

> 浏览器直接加载的静态资源与页面入口。

- 目录：`public/`（71）
- 根级文件：`index.html`、`style.css`

### 1.4 文档类（13 个条目 · 173 个文件）

> 说明、规范、进度与许可，以及工程文档附件与变更片段。

- 目录：`docs/`（81）、`changelog.d/`（81，上游 changesets 变更片段）
- 根级文件（11 个）：`AGENTS.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`DATA_SOURCES.md`、`FPS优化方法.md`、`LICENSE`、`PROGRESS.md`、`README.md`、`SECURITY.md`、`TESTING.md`、`THIRD_PARTY_NOTICES.md`

### 1.5 脚本类（10 个条目 · 526 个文件）

> 开发、验收、部署与安装的辅助可执行脚本。

- 目录：`scripts/`（504）、`tools/`（8）、`pinokio/`（7）
- 根级文件（7 个）：`_probe_bridge.mjs`、`_probe_routes.mjs`、`guard_backend.ps1`、`start-dev.cmd`、`start-prod.cmd`、`start-tunnel.cmd`、`start_gods_eye_hidden.vbs`

### 1.6 产物类（0 个条目）

> 验收产物目录 `evidence/`（原 3623 个文件）已于 2026-11-05 经用户确认清理出库（本地删除 + `git rm`），并加入忽略规则；一次性 QA 脚本（`scripts/bench-*`、`dbg-*`、`mat-*` 等）仍以 `evidence/_collab/` 为输出目录，属运行期生成物，不再入库。
> `out-qa/`（35 个验收 JSON）与 `vite.err` 于 2026-11-07 补做 `git rm --cached` 出库（此前 `.gitignore` 已写规则但文件仍在库内，规则对已跟踪文件无效），本地保留。

### 1.7 覆盖校验

| 类别 | 顶层条目数 | 文件数 |
| --- | ---: | ---: |
| 源码类 | 4 | 2633 |
| 配置类 | 18 | 27 |
| 资源类 | 3 | 73 |
| 文档类 | 13 | 173 |
| 脚本类 | 10 | 526 |
| 产物类 | 0 | 0 |
| **合计** | **48** | **3432** |

顶层条目 48/48、文件 3432/3432，每个条目只出现一次，未分类文件 0 个，无「其它」兜底类。
`out-qa/` 与 `vite.err` 已于 2026-11-07 移出版本库（本地保留并已在 `.gitignore:50-51` 忽略），因此不再是仓库顶层条目；`evidence/` 于 2026-11-05 经用户确认删除（见 1.6）。
本期数字全部于 2026-11-07 以 `git ls-files` 重测：`gods-eye-pro` 时代（5969 文件 / 44 条目）已失效，上游合并带来 `changelog.d/`、`.vercel/`、`compose.yaml`、`Dockerfile`、`docs/translations` 等条目。

---

## 2. 目录结构概览

```
gods-eye-pro/                          （48 个顶层条目 · 3432 个文件）
│
├─ 源码类 ────────────────────────────────────────────────
│  ├─ src/          2485   data/682 · layers/580 · ui/400 · voice/133 · app/75 · tools/65
│  ├─ server/        139   providers/125（本地数据代理中间件）· standalone/9 · mcp/5
│  ├─ build/           8   构建期模型处理与 Vue 加载器
│  └─ api/             1   Vercel 桥接入口
│
├─ 配置类 ────────────────────────────────────────────────
│  ├─ .github/         6   workflows/ · ISSUE_TEMPLATE/ · CODEOWNERS
│  ├─ config/          4   CCTV 数据源配置
│  ├─ .vercel/         2   部署路由
│  ├─ .agents/         1   协作技能定义
│  └─ 根级 14 个        .gitignore / .gitattributes / .prettierrc.json / Dockerfile /
│                        compose.yaml / package.json / vite.config.js / vercel.json 等
│
├─ 资源类 ────────────────────────────────────────────────
│  ├─ public/         71   models/36 · vessel-photos/7 · icons/5 · events/4 · data/3 …
│  └─ 根级 2 个         index.html · style.css
│
├─ 文档类 ────────────────────────────────────────────────
│  ├─ docs/           81   工程文档、架构说明，含 media/20 · translations/11 · architecture/10
│  ├─ changelog.d/    81   上游 changesets 变更片段（未发布）
│  └─ 根级 11 个        README.md · AGENTS.md · PROGRESS.md · CHANGELOG.md …
│
├─ 脚本类 ────────────────────────────────────────────────
│  ├─ scripts/       504   lc/310 · voice-bench/12 · _archive/14 · fixtures/6 · 根级脚本
│  ├─ tools/           8   辅助工具（街景 / 卫星正射等）
│  ├─ pinokio/         7   安装 / 启动 / 更新脚本
│  └─ 根级 7 个         _probe_*.mjs · guard_backend.ps1 · start-*.cmd · *.vbs
│
└─ 产物类（空） ──────────────────────────────────────────
   ├─ evidence/    已删除（2026-11-05 用户确认清理，gitignore）
   └─ out-qa/ · vite.err   已出库（2026-11-07 git rm --cached，本地保留，gitignore）
```

---

## 3. 本次目录重组

1. **证据域独立**：`docs/lg-glass-shots/`、`docs/_collab/`、`docs/mobile-shots/` 移入顶层 `evidence/`，共 3623 个文件以 rename 方式迁移；`docs/` 从 3684 个文件收敛到 62 个纯工程文档，文档与验收证据边界清晰。
2. **引用同步**：全仓 118 个文件中的 197 处路径引用由 `docs/<证据目录>` 批量改为 `evidence/<证据目录>`，替换后旧路径残留 0 处。
3. **产物出库（2026-11-05 立项，2026-11-07 补做）**：`out-qa/`（35 个验收 JSON）与 `vite.err`（运行日志）从版本库移出，本地保留并加入忽略规则。**11-05 当时仅写了 `.gitignore` 规则但未 `git rm --cached`，规则对已跟踪文件无效，11-07 实测两者仍在库内（36 行）**，已按清单 A2 补做，跟踪文件 3470 → 3432。
4. **保持原位**：`src/`、`server/`、`api/`、`build/`、`public/`、`.github/`、`config/`、`.agents/`、`scripts/`、`tools/`、`pinokio/` 均按原模块结构保留；根级 11 份文档与 7 个启动/探针脚本因平台约定（README/LICENSE/AGENTS/CONTRIBUTING/SECURITY）与相对路径、任务计划依赖，保持根目录原位，未移动。
5. **未执行**：`scripts/` 根级 356 个脚本的二级分组需要逐个判定用途，且 `scripts/lc/` 有 143 处路径引用，本次未做，以免误判。
6. **双重校验（2026-11-07 重测）**：顶层条目 48/48、叶子文件 3432/3432，均无重复、无遗漏、无未分类项。上游 2489 提交合并后再测，`gods-eye-pro` 时代的 44 条目 / 5969 文件已失效（见 1.7）。
7. **evidence 域出库（2026-11-05）**：经用户确认，`evidence/`（3623 个文件，约 1.7 GB）自版本库与本地工作树删除，`docs/REPO-STRUCTURE.md` 同步更新；历史提交与 `PROGRESS.md` 中的证据路径引用属历史记录，不再回改。
8. **小程序文档出库（2026-11-07）**：清单 A1 落地——`docs/上帝之眼小程序-工程档案-Hermes-Agent-20261024.md`、`docs/小程序能力反向移植清单.md` 以 `git rm --cached` 取消跟踪，本地保留；`.gitignore` 的 `*小程序*` 规则自此真正生效。
