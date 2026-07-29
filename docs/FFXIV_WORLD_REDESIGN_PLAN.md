# 最终幻想 XIV 世界页重构方案

> 状态：已实施并通过本地验收
>
> 日期：2026-07-26（2026-07-29 更新公开边界）
>
> 目标：把原本承载全部内容的单页编年拆成“世界入口 + 规范编年 + 镜界 + 旅途”四个职责清晰的页面，同时保证 439 条记录始终只有一个规范事实来源。

## 一、结论

1. `ff14.html` 是水晶星海世界入口，不再直接加载完整时间轴。
2. `ff14-chronicle.html` 是全部 FFXIV `CanonicalRecord` 的唯一规范 URL。
3. `ff14-reflections.html` 用“原初世界 + 十三镜像”的空间模型阅读记录，但不复制正文。
4. `ff14-journeys.html` 用八段冒险长弧阅读相同记录，负责表达版本主题、地点与旅途转折。
5. 1.x 至 6.0 作为海德林与佐迪亚克篇；6.1 起在站内单列为终章后的阅读路径，避免把后续故事继续塞进已经完结的旧篇，也不把该分段冒充官方新篇章名。
6. 当前公开边界更新为 2026-07-29 可核验的 Patch 7.55；官方 7.55 补丁说明没有新增主线任务，因此剧情仍至 7.5 第一部，且不提前编写尚未公开的 7.56。

## 二、信息架构与 URL

```text
最终幻想 XIV / 水晶星海
├─ 星海编年        ff14-chronicle.html#<record-id>
│  ├─ 原初世界主线
│  ├─ 镜像史
│  │  ├─ 第一世界
│  │  └─ 第十三世界
│  ├─ 秘话
│  └─ 设定索引
├─ 镜界棱镜        ff14-reflections.html?reflection=<id>#<id>
└─ 旅途星座        ff14-journeys.html?journey=<id>#<id>
```

镜界与旅途是 Lens，不是第二套内容页。它们的记录链接全部回到
`ff14-chronicle.html#<record-id>`。旧 `ff14.html#<record-id>` 只迁移一次到规范编年；普通首页锚点和新 Lens 参数不重定向。

## 三、领域模型

### 十四个世界

模型严格使用“原初世界 + 十三镜像 = 十四个世界”：

- 未分割的古代世界是分割发生前的状态，不是第十五个世界。
- 镜像世界是空间—以太结构，不是十四条平行时间线。
- 第一世界、第十三世界和第九世界只在有可追溯公开资料时点亮。
- 尚无可靠公开索引的镜像保留为空白节点，不编造文明、属性或历史。
- 天外文明不占用镜像编号；Vana’diel 等联动世界属于外部世界。

### 规范记录

- `src/_data/ff14.json` 保存 439 条规范记录、稳定 ID、来源和覆盖边界。
- `src/_data/ff14Catalog.js` 只把记录 ID 投影为十四镜界和八段旅途。
- 编年、镜界与旅途不得各自维护正文副本。
- 碎片历史使用 `eras[].events[]`，不再借用“结局分支”字段。
- 所有正式记录至少有一个 HTTPS 来源。

## 四、内容边界

### 主线阶段

```text
Legacy 1.x
→ A Realm Reborn 2.x
→ Heavensward 3.x
→ Stormblood 4.x
→ Shadowbringers 5.x
→ Endwalker 6.0
→ 终章后的站内阅读分段 6.1–6.x
→ Dawntrail 7.x
```

新增当前边界记录覆盖：

- 6.1 “崭新的冒险”
- 7.0 图拉尔启航、继承仪式、黄金乡与亚历山德里亚
- 7.3 亚历山德里亚篇阶段性终点
- 7.5 第一部“向天之路”

“亚历山德里亚”不与“整个第九世界”画等号；页面只陈述官方材料能够支持的关系。

### 来源优先级

1. Square Enix 官方版本页、故事页与官方出版物。
2. 中文维基的条目级或主题级汇编，用作既有长尾记录的可追溯入口。
3. 正文保持原创摘要，不大段复刻资料页。

主要官方核验入口：

- [Endwalker 6.0 Story](https://na.finalfantasyxiv.com/endwalker/patch_6_0/story)
- [Patch 6.1](https://na.finalfantasyxiv.com/endwalker/patch_6_1/)
- [Patch 6.2](https://na.finalfantasyxiv.com/endwalker/patch_6_2/)
- [Dawntrail](https://na.finalfantasyxiv.com/dawntrail/)
- [Dawntrail World](https://na.finalfantasyxiv.com/dawntrail/world/)
- [Patch 7.3](https://na.finalfantasyxiv.com/dawntrail/patch_7_3/)
- [Patch 7.5](https://na.finalfantasyxiv.com/dawntrail/patch_7_5/)
- [Shadowbringers Story](https://eu.finalfantasyxiv.com/shadowbringers/story/)

## 五、视觉与交互

视觉语言不复用明日方舟的工业终端或战锤 40K 的帝国档案：

- 世界首页：水晶、以太流、星海和柔和视差。
- 编年：可持续向下阅读的水晶长卷。
- 镜界：十四面晶体棱镜，只有有资料的节点发光。
- 旅途：八颗旅途星构成连续星座，但 6.0 与 6.1 之间明确换篇。

交互必须满足：

- 鼠标、键盘与触摸均能选择镜界和旅途。
- 当前按钮同步 `aria-pressed`，非当前面板真正隐藏。
- URL 同步查询参数与锚点，可复制、刷新和后退恢复。
- `prefers-reduced-motion` 下停用视差和持续动画。
- PC 保留完整空间构图；手机转换为正常顺序阅读，不要求横向拖动。
- 无脚本时仍能阅读主编年、全部镜界面板和全部旅途面板。

## 六、实施顺序与验收

1. 迁移数据并锁定覆盖边界。
2. 建立唯一规范路由与旧链接迁移。
3. 实现世界入口、编年、镜界、旅途四页。
4. 修复递归上下文、碎片深链和虚拟时间轴的通用能力。
5. 给旧 TXT 转换器增加现代档案防覆盖保护。
6. 执行数据校验、构建、静态链接 / 锚点检查与桌面视觉验收。

完成标准：

- 14 个镜界节点、8 段旅途、439 条记录来自同一档案。
- 所有 Lens 链接都落到唯一规范记录 URL。
- 7.5 第一部可读，未发布内容不伪装成既成事实。
- 深链打开正确根分栏与子分栏，时间轴不因说明块崩溃。
- 构建与自动化测试全部通过。
