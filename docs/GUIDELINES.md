# 实现防污染清单

## 一、DOM 操作规则

| 规则 | 禁止 | 允许 |
|------|------|------|
| Engine 层 DOM 操作 | `virtual-timeline.js` 不得直接操作 DOM | 只计算位置/可见范围，通过回调通知 UI |
| Data 层 DOM 操作 | `data-access.js` 永远不接触 DOM | 只返回数据 |
| 批量 DOM 写入 | 在 `requestAnimationFrame` 内逐个创建节点 | `DocumentFragment` 或 `innerHTML` 一次性注入 |
| DOM 查询缓存 | 每帧重复 `document.getElementById` | 模块初始化时缓存引用到闭包变量 |

## 二、动画循环规则

| 规则 | 说明 |
|------|------|
| 单一 rAF 入口 | 每个页面只有一个 `requestAnimationFrame` 循环。星图页：Three.js renderer_loop。世界页：`ParticleBackground._start()` |
| rAF 内禁止逻辑 | `requestAnimationFrame` 回调只做：读时间 → 计算状态 → 调渲染函数。禁止在 rAF 内做 fetch/事件注册/DOM 创建 |
| 动画参数来源 | 所有 duration/easing 必须来自 `anim-tokens.js`。禁止硬编码 `300` 或 `cubic-bezier(...)` |
| 时间来源 | 所有动画使用 `clock.getElapsedTime()` 或 `performance.now()`。禁止 `Date.now()` |

## 三、事件处理规则

| 规则 | 说明 |
|------|------|
| scroll 节流 | `scroll` 事件必须 `requestAnimationFrame` 节流或 `IntersectionObserver`。禁止直接在 scroll handler 中做布局计算 |
| resize 防抖 | `resize` 事件必须 debounce ≥150ms。禁止每次 resize 都触发重建 |
| mousemove 节流 | Canvas 交互的 mousemove 必须 rAF 节流 |
| 事件注册位置 | 所有事件监听器在 `init()` 中注册，在 `destroy()` 中移除。禁止模块顶层 `addEventListener` |

## 四、纯函数规则

| 函数类型 | 必须是纯函数 | 可以有副作用 |
|----------|-------------|-------------|
| Data 层所有函数 | ✅ | ❌ |
| Engine 层计算函数 | ✅ `VirtualTimeline.calculateVisibleRange()` | ❌ |
| Engine 层注册/通知 | ❌ | ✅ `onVisibleChange(fn)` |
| UI 层渲染函数 | ❌ | ✅ `renderCards()`, `updateEraNav()` |
| anim-tokens.js | ✅ 只导出常量 | ❌ |

## 五、缓存规则

| 资源 | 缓存策略 | 失效时机 |
|------|----------|----------|
| 世界数据 JSON | `Map<worldId, data>`，首次 fetch 后永久缓存 | 页面刷新 |
| event-index | `Map<'__idx', index>`，首次 fetch 后永久缓存 | 页面刷新 |
| 星团 3D 位置 | Three.js `Vector3` 对象，每帧投影 | destroy 时清理 |
| Canvas 粒子 | `ParticleBackground` 实例内数组 | `switchTo` 时重建 |
| DOM 引用 | 模块闭包变量，`init()` 时缓存 | 不失效 |

**禁止**：
- 同一 JSON 请求两次
- rAF 内做 fetch
- 缓存过期/失效逻辑（本站数据不变化）

## 六、模块 import 规则

| 允许 | 禁止 |
|------|------|
| UI → Engine → Data（单向） | Data → 任何上层 |
| 同层：`anim-tokens.js` 被任何层 import | Engine → UI |
| UI 内：`timeline-ui.js` → `VirtualTimeline` API | UI 内循环依赖 |
| | `window.` 全局变量通信（零容忍） |

## 七、CSS 规则

| 规则 | 说明 |
|------|------|
| 世界主题隔离 | `.world-arknights` / `.world-wh40k` / `.world-ff14` 前缀，在 `worlds.css` 中定义 |
| 新增颜色必须走 CSS 变量 | ❌ 硬编码 `#d4923a`。✅ `var(--ark-amber)` |
| 间距/圆角/阴影 | ❌ 硬编码 `8px` / `0 4px 24px rgba(...)`。✅ `var(--radius-md)` / `var(--shadow-card)` |
| 过渡 | ❌ 硬编码 `300ms ease`。✅ `var(--transition-normal)` |
| z-index 分层 | 背景层 0 / 内容层 10-20 / 覆盖层 80-100 / 传送门 300 / portal-arrival 9999。禁止随机值 |

## 八、移动端降级规则

| 检测方式 | `window.innerWidth < 768` 或 `matchMedia('(max-width: 768px)')` |
|----------|------|
| 检测时机 | 模块 `init()` 时检测一次，`resize` 时 debounce 重新检测 |
| Three.js 粒子数 | 桌面 150K / 移动 30K，`init()` 时决定，不动态切换 |
| Canvas 2D 星数 | 桌面按 preset / 移动 × 0.6 |
| backdrop-filter: blur | 移动端检测 `CSS.supports()`，不支持则 fallback 为 `rgba` 背景 |
| 3D 倾斜卡片 | 移动端关闭 `mousemove` 监听 |
| 传送门动画 | 移动端简化为 `opacity fade`，跳过 Canvas 粒子效果 |

## 九、构建规则

| 规则 | 说明 |
|------|------|
| validate 先于一切 | `npm run build` 第一步是 `validate-data.js`，失败则 exit(1) |
| 不做 file:// 兼容 | HTML 中不出现 inline JSON，所有数据走 fetch |
| Three.js 精确版本 | `package.json` 中 `"three": "0.136.0"`，不加 `^` 或 `~` |
| esbuild 入口 | `main.js` → `bundle.js`（世界页）+ `star-map-entry.js` → `star-map-3d.js`（首页），两个独立 bundle |
| 产出检查 | build 后验证 `dist/data/event-index.json` 存在且非空 |

## 十、发布与日志规则

| 规则 | 说明 |
|------|------|
| 双日志强制更新 | 每次推送到 GitHub 都必须同时更新 `docs/更新日志.md` 和 `docs/开发日志.md` |
| 更新日志职责 | 面向访客，说明版本新增内容、修复和可见变化，保持简洁 |
| 开发日志职责 | 面向维护，记录问题背景、技术方案、验证结果、遗留风险和下一步 |
| 版本一致 | `package.json` 当前版本必须同时出现在两份日志中 |
| 版本格式 | 所有版本统一使用三段格式 `x.x.x`，以 GitHub 仓库当前版本为递增基准 |
| CI 阻止遗漏 | push 未包含任意一份日志时，GitHub Actions 直接失败并停止部署 |
| CI 阻止非法版本 | `package.json` 不是三段版本号时禁止部署 |

## 十一、文档修改记录

### 记录规则

- OpenAI Codex 对本文件进行任何内容修改时，必须在交付前追加一条记录。
- 记录至少包含日期、对应版本、修改者、修改内容和修改原因。
- 历史记录只允许追加，不得覆盖、删除或改写；更正旧记录时应新增一条更正说明。

| 日期 | 版本 | 修改者 | 修改内容 | 修改原因 |
|------|------|--------|----------|----------|
| 2026-07-12 | V2.5.5 | OpenAI Codex | 更新 esbuild 双入口说明；新增双日志强制更新、日志职责、版本一致和 CI 阻断遗漏规则。 | 让拆包架构与单人维护发布流程成为可执行规范。 |
| 2026-07-12 | V2.5.5 | OpenAI Codex | 新增三段版本格式 `x.x.x` 及 CI 阻断非法版本规则。 | 固化用户确认的版本策略，防止错误版本进入部署。 |
| 2026-07-12 | V2.5.6 | OpenAI Codex | 新增本节及强制追加式修改记录规则。 | 确保 Codex 对实现规范文档的修改全部可追溯。 |
| 2026-08-02 | V2.6.0 | OpenAI Codex | 核对三段版本、双日志守卫、生产构建验证和星图原型隔离规则。 | 确保 V2.6.0 可按同一流程重复发布且不混入实验页面。 |
