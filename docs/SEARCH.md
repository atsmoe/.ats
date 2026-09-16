# 档案检索维护

档案检索使用 [Pagefind Node API](https://pagefind.app/docs/node-api/) 生成静态中文索引，通过 [浏览器 API](https://pagefind.app/docs/api/) 查询。索引和查询均不使用外部搜索服务。

## 数据来源

`validate-data.js` → `dist/data/{arknights,wh40k,ff14}.json` → `archive-search-data.js` → `dist/pagefind/`。

投影只读取 `WorldArchive` 的 chronicle 快照，所有事件和结局只索引一次。标题、描述、日期、地点、人物、标签、结局条件、后续和路线说明进入全文；世界、分支、时代及争议提示作为结果信息。`worldRecordHref` 决定目标，集成战略结果保留 `record` 查询参数和记录锚点。更新源档案后正常运行 `npm run build` 即可重建，无需维护第二份内容。

`archive.json` 记录版本、总条数和各世界条数，供产物测试核对。构建检查缺失记录、重复 ID 和不存在的目标页面，先写临时目录，再替换索引。

## 运行与验证

```sh
npm ci
npm run build
npx playwright install chromium
npm run test:browser
```

已有兼容 Chrome 时，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` 使用现成浏览器。浏览器测试启动只监听 `127.0.0.1:4173` 的静态服务，覆盖根目录与 `/.ats/` 路径、桌面和手机、中文输入法、筛选与历史、分页、网络重试、输入转义、键盘和无脚本入口。PR 工作流运行相同构建与浏览器检查，不部署站点。

检索页使用独立 bundle；首页和世界页只增加导航链接。页面空闲时不请求索引，查询时加载 Pagefind 与所需分片，每批最多渲染十条记录。禁用脚本时提供三个世界入口。搜索摘要会公开剧情与结局，因此搜索框前后保留剧透说明。

## 边界

- 只搜索已收录的事件与结局，暂不检索独立导航页、来源网页全文或尚未收录的剧情。
- 构建和查询共用汉字边界，单个关键词按连续短语匹配，空格分隔的多个关键词取交集，避免「水月」误中「水晶／卫月」，也避免构建词典和浏览器分词对「亚马乌罗提」等专名的拆分不一致。摘要去除索引中的分隔空格。参见 [Pagefind 中文与短语匹配](https://pagefind.app/docs/multilingual/)。错字与未列入别称表的同义词暂不额外扩展。
- V2.8.7 增加 `archive-search-aliases.js` 显式别称表；同一词的别称与正式名称取并集，不同词仍取交集。仅扩展完整匹配的词，不做模糊纠错或局部字符串替换。结果显示实际命中的字段类别；原记录和原始链接保持不变。
- 请求超过十五秒后显示重试入口。搜索词通过 URL 分享，不另存本地搜索历史。
- 争议状态从与战锤阅读器共用的纯函数取得，搜索结果不会把争议记录呈现为已核验资料。
