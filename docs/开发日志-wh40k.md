# 战锤40K 世界观数据采集 · 开发日志

## 数据源

- **页面**：[Timeline of the Warhammer 40,000 Universe](https://warhammer40k.fandom.com/wiki/Timeline_of_the_Warhammer_40,000_Universe)
- **API**：`https://warhammer40k.fandom.com/api.php`（Fandom MediaWiki，返回干净 JSON）
- **抓取日期**：2026-06-19
- **覆盖**：远古（天堂之战）→ M42（不屈时代），共 13 个宏观 era / 381 条事件

> 中文源（灰机wiki `40kcn.huijiwiki.com`）与 Lexicanum 均被 Cloudflare JS 挑战拦截，
> 无法用脚本抓取。英文 Fandom 是本环境唯一可用源；事件由模型分批翻译为中文。

## 管线脚本（仓库首个真正采集管线）

| 脚本 | 作用 |
|---|---|
| `scripts/fetch-wh40k-timeline.js` | 调 Fandom MediaWiki API 抓 7 个根节（不重叠覆盖 48 个内容节），按 h2/h3 切分，产出 `docs/wh40k_timeline.json`（英文原始，381 事件，零重复）|
| `scripts/transform-wh40k.js` | 读原始 JSON → 31 节映射为 13 个 era → 站点 schema 英文草稿 `docs/wh40k_timeline.zh.json`（id `wh-017`→`wh-397`）|

### 关键技术发现

1. **Fandom `section=N` 返回该 toclevel-1 节及其全部嵌套子节**。故只抓 7 个根节
   （s2/s13/s17/s18/s19/s20/s22）即可零重复覆盖全部内容，而非逐节抓 48 次。
2. **节正文按"下一个任意级别标题"截断**：L2 父节正文仅含导言（到首个 L3 前），
   L3 子节正文在下一个标题处截断——天然不相交，无需去重。
3. **页面是叙事散文**（`<p>` 段落，无 `<li>` 表格），与 PRTS 的结构化年表不同。
   日期靠段落内 `.M##` 内联标记提取，无内联日期时回退到节标题日期区间。

## 站点 schema（事件字段）

```jsonc
{
  "id": "wh-017",              // 必填，跨三世界唯一，续号自 wh-017
  "dateDisplay": "ca. M30",     // 必填，原文日期字符串（翻译时转中文）
  "title": "星神降生",          // 必填
  "description": "...",         // 完整描述（翻译后）
  "location": "银河全域",       // 可选
  "characters": ["星神"],       // 可选
  "tags": ["死灵", "星神"],     // 可选，≤4
  "isKeyEvent": true            // 可选
}
```

> 既有手工事件 `wh-001`~`wh-016` 保留不动，新事件从 `wh-017` 续号。
> 只写入 `subEntities[0].timeline.branches[0].eras[].events[]`；顶层冗余 `eras` 已删。

## 术语对照表（翻译一致性基准）

### 种族 / 阵营
| EN | ZH |
|---|---|
| Necron / Necrontyr | 死灵 / 死灵族（前身为惧亡者）|
| C'tan / Star Gods | 星神 / 星神（C'tan）|
| Old Ones | 古圣 |
| Aeldari / Eldar | 灵族 |
| Krork / Orks | 克欧克 / 兽人（绿皮）|
| Jokaero | 猕卡罗 |
| Slann | 斯兰 |
| Humanity / Mankind | 人类 |
| Imperium of Man | 人类帝国 |
| Chaos | 混沌 |
| Enslavers | 奴役者 |

### 核心概念 / 地名
| EN | ZH |
|---|---|
| Warp / Immaterium / Sea of Souls | 亚空间 / 非物质界 / 灵魂之海 |
| Webway | 灵能网络（网道）|
| War in Heaven | 天堂之战 |
| Silent King | 沉默之王（萨雷克 Szarekh）|
| Triarch | 三执政 |
| phaeron | 法老王（王朝君主）|
| biotransference | 生体转化 |
| necrodermis | 活金属 |
| Dolmen Gates | 巨石之门 |
| Tesseract Labyrinth | 超立方迷宫 |
| Tomb World / Tomb Ship | 墓穴世界 / 陵舰 |
| psyker | 灵能者 |
| Adeptus Mechanicus | 机械教 |
| Ecclesiarchy | 国教教会 |
| Primarch | 原体 |
| Warmaster | 战帅 |
| Horus Heresy | 荷鲁斯之乱 |
| Great Crusade | 大远征 |
| Great Scouring | 大清洗 |
| Second Founding | 二次建军 |
| Eye of Terror | 恐惧之眼 |
| Cadian Gate | 卡迪安之门 |
| Astra Militarum / Imperial Guard | 星界军 / 帝国卫军 |
| Tyranids / Hive Fleet | 泰伦虫族 / 蜂巢舰队 |
| T'au / Tau Empire | 钛族 / 钛帝国 |
| Era Indomitus | 不屈时代 |
| Indomitus Crusade | 不屈远征 |
| Primaris | 原铸（星际战士）|
| Guilliman | 基利曼 |
| Abaddon | 阿巴顿 |
| Black Crusade | 黑色十字军 |

### 神话 / 具体实体
| EN | ZH |
|---|---|
| Mephet'ran / the Deceiver | 欺诈者（梅菲特兰）|
| Nyadra'zath / the Burning One | 燃烧者（尼亚德拉扎斯）|
| the Outsider | 局外人 |
| Laughing God | 笑神 |
| Szarekhan Dynasty | 萨雷汗王朝 |
| Solemnace | 索勒姆纳斯（墓穴世界）|
| Book of Mournful Night | 哀夜之书 |
| Black Library | 黑图书馆 |
| Orikan | 奥里坎 |

### 历法
- `M##` = 第 N 个千年（M30 = 第30千年）。`ca.` = 约。`Unknown Date` = 未知日期。
- 例：`ca. 005-014.M31` = 第31千年 005-014 年（约）。

## 已知限制

1. 翻译由模型完成（无翻译 API 可用），术语严格按上表，但长句偶有生硬处，可后续人工润色。
2. 现有 `wh-001`~`wh-016` 与新 era 在主题上有重叠（纪元前/大远征/荷鲁斯之乱），
   保留手工版作为精炼概览，新数据为细节扩展。
3. 叙事散文拆分出的"事件"粒度较粗（一段一事件），不如 PRTS 的逐条年表精细，
   但忠实还原了 Fandom 原文的叙事结构。
