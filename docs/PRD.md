# PRD：群星之间 · 编年史 V2.0

## Problem Statement

V1 是单页应用（index.html 2240 行），所有 CSS / JS / 数据内联在一个文件中。随着加入第二个世界（战锤 40K）和更多 IF 分支线，单页架构暴露出以下问题：

- **URL 不独立**：每个世界没有独立可分享的 URL，无法深链到特定世界或事件
- **内容耦合**：两个世界的 HTML / JS / CSS 混在一起，维护者互相干扰
- **加载负担**：所有世界的数据必须一次性加载（内联 JSON ~250KB）
- **扩展性差**：后续计划添加 5-10 个世界，SPA 模式无法承受

## Solution

将 SPA 重构为**多页静态网站**，使用 11ty（Eleventy）静态生成器 + esbuild 打包构建。

- 每个世界独立的 HTML 文件（arknights.html / wh40k.html）
- 星图首页（index.html）作为世界入口
- 公共导航栏和页脚抽离为 Nunjucks 模板
- 源码使用 ES modules 开发，esbuild 打包为 IIFE
- JSON 数据通过 fetch 加载（开发服务器热更新）
- 跨世界引用支持传送门过渡动画（出发侧扩散 → 跳转 → 到达侧反向收束）

## User Stories

1. 作为访客，我希望进入网站时看到一片深邃的星空背景，有粒子动态效果，立刻感受到沉浸氛围
2. 作为访客，我希望在星图上看到多个世界入口（星系），鼠标靠近时有发光反馈
3. 作为访客，我希望点击星系查看详情，再点击"进入编年史"跳转到对应世界的独立页面
4. 作为编年史读者，我希望看到一条垂直的时间轴线，事件卡片沿轴线左右交替排列
5. 作为编年史读者，我希望向下滚动时新的事件以淡入/滑入动画出现
6. 作为编年史读者，我希望时间线事件的年份使用对应世界的历法（泰拉历 / 帝国历等）
7. 作为编年史读者，我希望每个事件卡片包含：时间点、标题、描述、可选的角色/地点/标签
8. 作为编年史读者，我希望在时间线分叉节点处切换到不同 IF 世界线
9. 作为编年史读者，我希望点击跨世界引用时触发传送门过渡动画，跳转到另一个世界的关联事件
10. 作为编年史读者，我希望能通过顶部导航栏在不同世界之间自由切换
11. 作为内容维护者，我希望所有编年史数据存储在独立的 JSON 文件中，结构与页面逻辑分离
12. 作为内容维护者，我希望 JSON 数据结构支持记录：时间点、纪年法标签、事件标题、描述、图片路径、分支关系、跨世界引用

## Architecture

### 技术栈

- 纯 HTML + CSS + 原生 JavaScript，零运行时外部依赖
- 11ty（Eleventy）静态生成器，Nunjucks 模板引擎
- esbuild 打包 ES modules → IIFE bundle
- Canvas API 实现粒子网络背景和传送门过渡动画
- CSS 自定义属性管理配色变量，世界主题通过 body class 切换

### 源文件结构

```
src/
  _data/                          # 11ty 全局数据
    arknights.json                # 明日方舟世界数据
    wh40k.json                    # 战锤40K世界数据
    site.js                       # 数据聚合（按 worldId 索引）

  _includes/                      # Nunjucks 模板片段
    base.njk                      # 基础布局（HTML 骨架、portal-arrival、背景 canvas、JS 引用）
    nav.njk                       # 导航栏（active 类由模板变量控制）
    footer.njk                    # 页脚（版权 + 世界入口 + 关于链接）

  *.njk                           # 页面模板
    index.njk                     # 星图首页
    arknights.njk                 # 明日方舟时间线页
    wh40k.njk                     # 战锤40K时间线页
    about.njk                     # 关于页（项目介绍 + 使用指南）

  css/
    base.css                      # :root 变量、reset、排版、暗角、页脚
    nav.css                       # 顶部导航栏
    star-map.css                  # 星图视图 + 星系详情覆盖层
    timeline.css                  # 时间线、事件卡片、轴线、时代导航、回到顶部
    ref-panel.css                 # 引用面板 + 虫洞 + portal-arrival
    worlds.css                    # 世界主题变量（.world-arknights / .world-wh40k）
    responsive.css                # @media 响应式调整

  js/
    lib/
      virtual-timeline.js         # 虚拟滚动引擎（独立全局库）

    modules/                      # ES modules（esbuild 打包入口）
      bg-presets.js               # 背景预设配置
      particle-background.js      # Canvas 粒子引擎类
      background-manager.js       # 背景管理器（init 模式）
      galaxies.js                 # 星系定义 + 动画状态
      worlds.js                   # 世界注册表
      star-map.js                 # 星系交互（仅星图页加载）
      data-loader.js              # 数据加载（内联优先 + fetch 回退）
      timeline-ui.js              # 时间线 UI（分支标签、事件渲染、时代导航、3D 倾斜）
      ref-panel.js                # 跨世界引用面板 + 虫洞动画
      portal-transition.js        # 传送门过渡（出发 + 到达）
      nav.js                      # 导航栏初始化
      main.js                     # 入口：按 data-page 分发初始化
```

### 构建输出

```
dist/
  index.html
  arknights.html
  wh40k.html
  about.html
  css/ (7 个文件)
  js/
    virtual-timeline.js
    bundle.js (62KB)
  data/
    arknights.json
    wh40k.json
```

### 页面渲染流程

```
星图页 (index.html)：
  DOM 解析 → BackgroundManager.init() → switchTo('star-map')
  → initNav()（导航栏淡入）→ initStarMap()（星系入场动画 + 悬停检测 + 点击打开详情）
  → 点击"进入编年史" → window.location.href = './arknights.html'

世界页 (arknights.html / wh40k.html)：
  DOM 解析 → #portal-arrival 遮罩覆盖全屏
  → BackgroundManager.init() → switchTo(世界预设)
  → loadWorldData()（fetch 加载世界 JSON）
  → populateBranchTabs() → renderEvents('mainline') → VirtualTimeline.load + update
  → initPortalArrival()（处理到达侧传送门动画，如有 hash 锚点）
```

### 跨世界引用：传送门过渡

出发侧：
  1. 用户点击 .cross-world-link（e.preventDefault）
  2. 以点击坐标为圆心，Canvas 涡旋粒子向外螺旋扩散（~300ms）
  3. 光晕覆盖层从点击点 scale(0) → scale(1) 全屏覆盖
  4. 不透明度到达 1.0 → window.location.href = './wh40k.html#evt-xxx'

到达侧：
  1. #portal-arrival（内联 div，#060a14 深空底色）从 HTML 解析第一刻遮住全屏
  2. fetch 加载世界数据（开发服务器提供）
  3. 解析 location.hash 得到目标事件 ID
  4. 在已加载数据中搜索目标事件，获取其所在分支及分支内序号
  5. 构建分支时代分组，直接交付 VirtualTimeline.load()（仅构建 ~15 个视口节点）
  6. 若目标序号 > 20：通过 VirtualTimeline.estimateScrollTopByEventId() 预估偏移并 scrollTo
  7. VirtualTimeline.update() 触发首帧渲染 + remeasure 高度校正
  8. 播放反向收束动画（Canvas 粒子 + 光晕收缩到目标位置，~400ms）
  9. 移除遮罩（VirtualTimeline 已就绪，无需二次加载）

### 配色方案

- 背景底色：深黑 `#080810` / `#060a14`
- 主色调（金铜粒子）：`#c9a050` / `#a08030`
- 高亮色（发光粒子）：`#f0d878`
- 文字主色：`#e8dcc8`（暖白）
- 文字辅色：`#9a9078`
- 轴线颜色：`#3a3020`（暗金）
- 世界主题色：明日方舟琥珀 `#d4923a` / 战锤40K深红 `#c85050`
- 卡片背景：`rgba(20, 18, 10, 0.85)` + backdrop-filter: blur()

### 字体

- 标题：思源宋体（Noto Serif SC），font-weight: 700
- 正文：思源黑体（Noto Sans SC），font-weight: 400
- 纪年数字：等宽数字，font-variant-numeric: tabular-nums

### 响应式策略

- 桌面优先（min-width: 1024px 为主要适配范围）
- 移动端（≤768px）：所有卡片右置不交替，粒子特效降级，3D 倾斜关闭
- 平板（769-1024px）：卡片宽度缩小

### JSON 数据结构

```json
{
  "world": {
    "id": "arknights",
    "name": "明日方舟",
    "category": "game",
    "description": "...",
    "calendarSystem": "泰拉历",
    "themeColor": "#d4923a",
    "bgPreset": "arknights"
  },
  "subEntities": [{
    "id": "main",
    "name": "主线编年史",
    "timeline": {
      "branches": [
        {
          "id": "mainline",
          "name": "主世界线",
          "isDefault": true,
          "eras": [
            {
              "title": "【纪元前】",
              "events": [
                {
                  "id": "evt-001",
                  "dateDisplay": "约纪元前8000000",
                  "title": "前文明鼎盛",
                  "description": "...",
                  "location": "泰拉",
                  "characters": [],
                  "tags": ["前文明"],
                  "crossRefs": [{ "worldId": "wh40k", "eventId": "wh-001", "label": "→ 灵族鼎盛" }]
                }
              ]
            }
          ]
        },
        {
          "id": "if-integrated",
          "name": "集成战略世界线",
          "type": "integrated-strategy-group",
          "subBranches": [
            {
              "id": "if-ceobe",
              "name": "刻俄柏的灰蕈迷境",
              "divergeAtEventId": "evt-051",
              "endings": []
            }
          ]
        }
      ]
    }
  }]
}
```

### 页面状态管理

- 不再有 SPA 的全局状态切换。每个页面独立加载，通过 body.dataset.page 和 body.dataset.world 标识页面类型
- main.js 入口读取 data-page 分发初始化逻辑（star-map / world / about 三条路径）
- 页面间导航使用真实 `<a href="">` 链接，不再通过 JS 状态机切换
- 导航高亮由 11ty 模板变量在构建时静态确定，不需要 JS

### 构建与部署

- 开发：`npm run dev` 启动 11ty 开发服务器（localhost:9000），支持模板 / CSS / JS 热更新
- 生产构建：`npm run build` → 11ty 构建 HTML + esbuild 打包 JS + 复制 CSS → dist/
- 部署：dist/ 部署到静态托管（如 GitHub Pages），数据通过 fetch 加载
- 路径策略：全部相对路径（./js/bundle.js, ./arknights.html），兼容任意静态托管子路径

## Decisions (已确认的技术决策)

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 静态生成器 | 11ty（Eleventy） |
| 2 | 构建输出 | dist/，源文件在 src/ |
| 3 | JS 模块化 | ES modules 开发 + esbuild 打包 IIFE，单一入口 + --splitting |
| 4 | 数据加载 | fetch 加载 JSON，开发服务器热更新 |
| 5 | CSS | 保持原生 CSS，开发用 `<link>` 分文件，生产用 shortcode 内联 |
| 6 | 导航高亮 | 11ty 模板渲染时静态确定，零 JS |
| 7 | 模板语言 | Nunjucks，base.njk 继承模式，UI 片段用 macro 封装 |
| 8 | 路径策略 | 全部相对路径（./） |
| 9 | 数据文件位置 | src/_data/，addPassthroughCopy 暴露为静态文件 |
| 10 | 跨世界引用 | 传送门过渡（Canvas 粒子扩散 + 收束） |

## Testing

### 测试原则

- 测试外部行为，不测实现细节
- DOM 断言优先于代码调用断言
- 特效动画用视觉回归测试（截图比对），不写时间断言

### 测试范围

1. 数据加载：JSON 格式合法性、必需字段完整性
2. 多页导航：星图 ↔ 各世界 ↔ 关于页的链接跳转正确
3. 分支切换：主线 ↔ IF 线切换后时间线内容替换正确
4. 粒子背景：Canvas 初始化无报错、鼠标事件响应、背景预设切换
5. 传送门过渡：出发侧扩散 → 跳转 → 到达侧收束 → 定位到目标事件
6. 响应式：不同 viewport 下的布局正确性
7. 构建产物：dist/ 输出文件完整性

### 测试工具

- Playwright 或 Cypress 做 E2E 和视觉回归
- 单元测试覆盖数据解析和状态管理纯函数

## Out of Scope (V2)

- 音效系统
- 用户自定义添加/编辑事件（CRUD UI）
- 后端/数据库集成
- 移动端完整体验（仅保证可读）
- 搜索/筛选功能
- 多语言支持
- 无障碍访问（ARIA labels 等）

## V1 → V2 变更摘要

- **架构**：SPA（单 index.html）→ 多页静态网站（4 个独立 HTML + 模板继承）
- **构建**：无构建步骤 → 11ty + esbuild 构建管线
- **JS**：全局脚本块 → ES modules + esbuild 打包
- **CSS**：单个内联 `<style>` → 7 个独立文件 + 按环境加载
- **导航**：JS 状态切换（enterWorld/returnToStarMap）→ 真实 `<a>` 链接
- **数据**：内联 JS 变量 → fetch 加载 + build-time 扁平化/索引
- **跨世界引用**：侧边面板 + 虫洞动画（无跳转）→ 传送门过渡（出发扩散 + 到达收束 + 实际跳转）
- **页脚**：无 → 版权 + 世界入口 + 关于链接
- **关于页**：无 → 项目介绍 + 使用指南
- **.gitignore**：无 → 完整的忽略规则
