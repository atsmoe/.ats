# 群星之间 · 世界档案 — 架构设计文档

## 一、产品形态

**定义**：可视化虚构世界档案——从 Three.js 星图首页进入不同世界，在编年、专题和图谱中阅读记录。

**核心体验路径**：
```
Three.js 星图首页
  → 选择世界信号 → 阅读世界摘要
    → 点击"进入世界档案" → 跳转到对应世界入口
      → 浏览事件时间线 → 点击事件卡片 → 查看图片/视频/描述
        → 点击跨世界引用 → 传送门过渡 → 到达另一世界
```

**页面构成**：

| 页面 | 模板 | 背景 | JS 入口 |
|------|------|------|---------|
| 星图首页 | `index.njk` | Three.js 星图 | `star-map-3d.js` |
| B4 星图预览 | `star-map-b4-prototype.njk` | Three.js 三世界天体观察台 | `star-map-b4-prototype.js` |
| B5 星图预览 | `star-map-b5-prototype.njk` | 三张固定 2D 观测场景 | `star-map-b5-prototype.js` |
| 明日方舟 | `arknights.njk` | Canvas 2D 琥珀粒子 | `bundle.js` |
| 战锤40K | `wh40k.njk` | Canvas 2D 深红粒子 | `bundle.js` |
| 最终幻想XIV | `ff14.njk` | Canvas 2D 银蓝粒子 | `bundle.js` |
| 关于 | `about.njk` | Canvas 2D 冷色粒子 | `bundle.js` |
| 更新日志 | `changelog.njk` | Canvas 2D 冷色粒子 | `bundle.js` |
| 档案检索 | `search.njk` | CSS 深空渐变 | `archive-search.js`，查询后加载 Pagefind |

**架构**：多页静态网站（11ty SSG），页面间 `<a href>` 跳转。

**架构红线**：

| 触发条件 | 当前决策 | 何时重评 |
|----------|----------|----------|
| 世界数量 > 10 | 静态多页 | 动态路由 + 模板引擎 |
| JS 模块 > 30 | 无 TypeScript | 引入 TypeScript |
| 单页资源 > 300KB | fetch 按需加载 | CDN + 图片优化管线 |
| 需要 CRUD UI | 无后端 | 引入后端 + 数据库 |
| 需要 SSR/深度 SEO | 纯静态 HTML | 考虑 Astro |
| 3D 交互升级 | Three.js 直用 | 评估 R3F |
| 多人协作 | 单人维护 | ESLint + Prettier + CI |

---

## 二、技术栈

### 核心依赖

| 层 | 技术 | 版本 | 理由 |
|----|------|------|------|
| SSG | 11ty (Eleventy) | ^3.0.0 | 轻量 Nunjucks 模板，零运行时框架 |
| JS 打包 | esbuild | ^0.25.0 | 快、IIFE 输出 |
| 3D 渲染 | Three.js | **0.136.0**（精确锁定） | 正式星图与 B4 公开预览各自独立打包，世界页不加载 |
| UI 组件 | 无 | — | 原生 HTML + CSS 实现 |

### 不引入的技术

| 技术 | 排除理由 |
|------|----------|
| React/Vue/Svelte | 运行时框架与零依赖策略矛盾 |
| Shoelace/任何UI库 | 项目所有 UI 是定制的，引入会产生双样式系统 |
| Tailwind CSS | 项目已有设计系统，引入会冲突 |
| CSS-in-JS | SSG + IIFE 环境不友好 |
| 后端框架 | 当前无后端需求 |
| TypeScript | 项目体量小。模块 >30 或多人协作时重评 |

### 重新评估条件

| 技术 | 触发条件 |
|------|----------|
| TypeScript | JS 模块 >30 或多人协作 |
| Astro | 需要 SSR 或深度 SEO |
| 图片CDN | 图片资源 >500 张 |
| 后端+数据库 | 需要 CRUD 或用户系统 |

---

## 三、数据系统

### Build-time（validate + flatten + index）

```
src/_data/*.json              ← 源数据（手写，叙事结构不变）
        ↓ validate-data.js
dist/data/*.json              ← 扁平化输出（branch.events 单路径）
dist/data/event-index.json   ← 全局事件索引
        ↓
   校验：schema + crossRef + eventId 唯一性
   失败：exit(1) 阻止构建
```

**validate-data.js 做的事**：
1. JSON schema 校验（world/event 必需字段）
2. crossRef 目标存在性检查
3. **eventId 全局唯一性检查**（重复 ID 直接 build fail）
4. 扁平化：`branches.eras.events` → `branch.events`（单路径）
5. 生成 `event-index.json`：`{eventId: {worldId, branchId, eventIndex}}`

**validate-data.js 不做的事**：
- 不生成 world-graph.json
- 不注入 incomingRefs
- 不做关系建模

### Runtime（data-loader.js + data-access.js）

**data-loader.js**：纯 fetch + in-memory Map 缓存，零 inline，零 fallback。

**data-access.js**：4 个 async 函数，UI 永远不直接访问数据结构。

```javascript
getWorldMeta(worldId)      // → { id, name, calendarSystem, ... }
getBranches(worldId)        // → [{ id, name, events, ... }]
getBranchEvents(worldId, branchId) // → [{ id, title, ... }]
findEventById(eventId)       // → { id, title, ... } | null  (O(1) via index)
```

### 架构约束

| 约束 | 规则 |
|------|------|
| event-index 唯一真源 | 只由 build-time 生成，runtime 永不修改或扩展 |
| 缓存策略 | data-access 内部 in-memory Map，首次 fetch 后永久缓存 |
| 无全局变量 | 通过 `document.body.dataset.world` 传递世界 ID，零 `window.` 全局变量 |
| 禁止图抽象 | runtime 和 build-time 不做 graph，除非未来 spec 明确引入 |

---

## 四、模块架构

### 依赖方向（严格单向）

```
┌──────────── UI Layer ────────────┐
│  main.js, star-map.js           │
│  timeline-ui.js, ref-panel.js   │
│  portal-transition.js, nav.js   │
└────────────┬────────────────────┘
             │ import / 调用
┌────────────▼ Engine Layer ──────┐
│  virtual-timeline.js            │
│  star-map-2d.js                 │
│  particle-background.js         │
│  background-manager.js          │
└────────────┬────────────────────┘
             │ import / 调用
┌────────────▼ Data Layer ────────┐
│  data-access.js                 │
│  data-loader.js                 │
└────────────────────────────────┘
```

**禁止反向依赖**：
- Data → Engine → UI（仅此方向）
- Data 不得 import Engine/UI
- Engine 不得 import UI
- Engine 通知 UI 通过回调注册模式，不反向 import

**Engine 状态边界**：
- Engine is stateless in UI terms
- Engine only emits events, does not store UI state

### 运行时数据传递

```html
<!-- base.njk -->
<body data-page="world" data-world="arknights">
```

```javascript
// main.js
const worldId = document.body.dataset.world;  // 唯一数据入口
const data = await loadWorldData(worldId);     // fetch 加载
```

无 `window.__WORLD_DATA__`，无 inline JSON。

---

## 五、星图首页与公开预览

### 场景边界

截至 V2.8.24，本仓库 `index.njk` 仍加载 `star-map-3d.js`，由 `star-map-entry.js` 打包 Three.js 星图。页面保留三个世界的静态兜底入口。二维固定底图属于 B5 公开预览，不应写成正式首页已采用的实现。

世界页使用独立 `bundle.js`，不包含 Three.js。正式首页的可访问性与销毁行为由后续 T02 单独复核，批次 A 不修改星图代码。

### 公开预览边界

B4 与 B5 使用独立模板、样式和 bundle。正式首页继续加载 `star-map-3d.js`；B5 使用固定二维底图、显式世界切换与键盘控制，不 import Three.js。生产清理只对白名单中的 B4、B5 页面及脚本放行。

### 编年事件档案连续导航

三套编年页面共用 `event-modal-navigation.js` 计算当前可见事件序列，并由 `event-modal-transition.js` 处理有方向的短过渡。弹窗关闭与模块销毁必须取消过渡和输入状态；系统减少动态效果时直接更新内容。

---

## 六、设计系统

### 配色

| 元素 | CSS 变量 | 值 |
|------|----------|-----|
| 背景底色 | `--bg-deep` | `#080810` |
| 主色 | `--gold` | `#c9a050` |
| 暗金 | `--gold-dim` | `#a08030` |
| 明金 | `--gold-bright` | `#f0d878` |
| 文字主色 | `--text` | `#e8dcc8` |
| 文字辅色 | `--text-muted` | `#9a9078` |
| 卡片背景 | `--card-bg` | `rgba(20, 18, 10, 0.85)` |

### 动画 Token（anim-tokens.js）

```javascript
ANIM.duration.fast    // 150ms — 微交互
ANIM.duration.normal  // 300ms — 标准过渡
ANIM.duration.slow    // 500ms — 重过渡
ANIM.duration.portal  // 700ms — 传送门

ANIM.easing.out       // cubic-bezier(0.16, 1, 0.3, 1)
ANIM.easing.in        // cubic-bezier(0.7, 0, 0.6, 1)
ANIM.easing.bounce    // cubic-bezier(0.34, 1.56, 0.64, 1)
```

---

## 七、构建管线

### V2.8.3 检索扩展

`build.js` 额外输出独立的 `archive-search.js`，并在页面、校验数据和图片构建完成后调用 `scripts/build-search.js`。它通过 `WorldArchive` 与共享路由生成事件和结局的搜索投影，核对 `event-index.json` 覆盖及页面存在性，再写入 `dist/pagefind/`。检索索引不包含导航、镜像 Lens 副本或图片；失败会终止构建。

浏览器首次查询时才加载 Pagefind，按世界筛选并批量取回结果摘要。搜索状态存于 `search.html?q=…&world=…`，结果共用现有记录深链，兼容站点根目录和 GitHub Pages 仓库前缀。Pagefind 自带 UI 未进入产物页面。详见 [检索维护说明](SEARCH.md)。

```
npm run build:
  1. assets:terra / assets:terra:territory    ← 泰拉素材派生
  2. validate-data.js --validate-only        ← 源数据检查
  3. convert-changelog.js → eleventy         ← 日志与页面
  4. validate-data.js                        ← 扁平化 + 索引
  5. build.js                               ← 独立 JS、CSS、图片、Pagefind
  6. build-b4-prototype.js / build-b5-prototype.js
  7. npm test                               ← Node 检查

npm run dev:
  相同素材与页面构建步骤，随后启动 scripts/dev-server.cjs
```

### V2.8.24 发布门禁

部署链依次执行依赖审计、生产构建（含 Node 测试）、Chromium 安装、`npm run test:browser`、产物检查、Pages 上传。部署 job 依赖 build 成功；检查后不重建或替换 `dist/`。PR 工作流只检查、不发布。失败和取消时尝试上传 Playwright HTML / JSON 报告、截图及 trace；产物名含完整提交 SHA、job 与运行尝试编号。取消时报告可能不完整，浏览器安装失败不产生浏览器报告。详见 [CI-01～CI-07 验收](RELEASE_GATE_ACCEPTANCE.md)。

### 构建产物

```
dist/
├── index.html
├── arknights.html
├── wh40k.html
├── ff14.html
├── about.html
├── changelog.html
├── data/
│   ├── arknights.json          (扁平化)
│   ├── wh40k.json              (扁平化)
│   ├── ff14.json               (扁平化)
│   └── event-index.json
├── assets/
│   ├── images/...
│   └── videos/...
├── css/
└── js/
    ├── bundle.js               (世界页/普通页，不含 Three.js)
    ├── star-map-3d.js          (正式星图专用，含 Three.js)
    ├── archive-search.js       (检索专用)
    ├── star-map-b4-prototype.js  (B4 公开预览独立 bundle)
    ├── star-map-b5-prototype.js  (B5 公开预览独立 bundle，不含 Three.js)
    └── virtual-timeline.js
```

---

## 八、移动端策略

| 等级 | 特性 | 桌面 | 平板 | 移动 |
|------|------|------|------|------|
| A | 时间线阅读 | ✅ | ✅ | ✅ 右置 |
| B | 2D 星图 | ✅ 固定构图 | ✅ 固定构图 | ✅ 正常阅读 |
| B | Canvas 2D 背景 | ✅ 500星 | ✅ 400星 | ✅ 300星 |
| C | 图片/视频 | ✅ | ✅ | ✅ |
| C | 传送门动画 | ✅ | ✅ | ✅ 简化fade |
| D | 3D 倾斜卡片 | ✅ | ✅ | ❌ |
| D | 鼠标光晕 | ✅ | — | — |

---

## 九、媒体资源策略

**存储**：`src/assets/images/` 和 `src/assets/videos/`，11ty passthrough 复制到 `dist/assets/`。

**图片优化管线**（以 V2.8.24 的 `build.js` 为准）：
- `build.js` 在构建时调用 `buildImages()`，扫描经准入处理的 `dist/data` 中引用的图片
- 对每张图片使用 `@11ty/eleventy-img`（底层 sharp）生成 WebP 格式，宽度 320/640/960
- 构建后处理 `dist/data/*.json`，自动将 `src` 指向 960w WebP 版本
- 已成功替换的原图只从 `dist` 移除，源素材保留；`ff14/public-originals/` 保持原始质量，不替换成 960w 派生图

**JSON 扩展**：
```json
{
  "images": [{
    "src": "./assets/images/xxx.webp",
    "alt": "...",
    "width": 960,
    "height": 540
  }],
  "video": { "src": "./assets/videos/xxx.mp4", "poster": "./assets/images/xxx-poster.jpg" }
}
```
- `width` / `height` 为可选字段，若存在则必须是 Number（渐进式校验，validate-data.js 仅 warn）

**运行时渲染**（timeline-ui.js）：
- 首张图片 `loading="eager"`，后续 `loading="lazy"`
- 全部图片 `decoding="async"`，避免阻塞主线程
- 若数据提供 `width`/`height`，直接设置 `img.width`/`img.height` 消除 CLS

**实现方式**：原生 HTML（`<dialog>` 灯箱、`<video>` 播放器、CSS transform 缩放），不引入 UI 库。

---

## 十、文档修改记录

### 记录规则

- OpenAI Codex 对本文件进行任何内容修改时，必须在交付前追加一条记录。
- 记录至少包含日期、对应版本、修改者、修改内容和修改原因。
- 历史记录只允许追加，不得覆盖、删除或改写；更正旧记录时应新增一条更正说明。

| 日期 | 版本 | 修改者 | 修改内容 | 修改原因 |
|------|------|--------|----------|----------|
| 2026-07-12 | V2.5.5 | OpenAI Codex | 在构建管线中补充 `npm test`；将产物说明更新为世界页约 38KB、首页星图约 517KB，并明确 Three.js 只进入首页 bundle。 | 记录可靠性测试接入和页面入口拆包后的真实架构。 |
| 2026-07-12 | V2.5.6 | OpenAI Codex | 新增本节及强制追加式修改记录规则。 | 确保 Codex 对架构文档的修改全部可追溯。 |
| 2026-08-02 | V2.6.0 | OpenAI Codex | 发布前核对三世界规范档案、多观测镜和本地星图原型的生产隔离边界。 | 使架构记录与 V2.6.0 的实际构建和发布范围一致。 |
| 2026-08-09 | V2.6.2 | OpenAI Codex | 将 B4 星图加入公开构建白名单，正式首页提供双向版本切换；其他旧原型继续隔离。 | 修正将线上切换误做成仅本地入口的发布边界错误。 |
| 2026-08-24 | V2.7.0 | OpenAI Codex | 新增独立 B5 二维观测预览，并记录三世界事件档案的连续导航与过渡边界。 | 保留正式粒子星图，允许线上并行评审 B4、B5，同时约束弹窗状态清理和减少动态效果。 |
| 2026-09-03 | V2.8.0 | OpenAI Codex | 统一发布三世界连续阅读、FFXIV 媒体溯源与 B5 观测星图的本地验收批次。 | 固定当前发布编号，保留远端默认首页与原型隔离边界，并让生产媒体只使用可核验的原图。 |
| 2026-09-08 | V2.8.3 | OpenAI Codex | 增补检索页面、索引构建管线与浏览器按需加载边界。 | 为现有档案提供统一查找入口，复用来源状态和稳定记录地址。 |
| 2026-09-17 | V2.8.24 | OpenAI Codex | 按实际模板与构建入口订正正式首页/B5 边界、构建顺序、媒体准入与发布浏览器门禁；移除无版本的旧体积数字。 | 执行任务书 T06，避免把历史二维方案和旧指标当作当前实现；不修改相关运行时代码。 |
