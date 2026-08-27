# openweb.wiki

**个人知识库** —— 项目、笔记、折腾记录，每条知识都有自己的地址。

- 在线站点：<https://openweb.wiki>
- 源码仓库：<https://github.com/Yutong-Fan/openweb-wiki>
- 部署方式：Cloudflare Pages（连接 GitHub 仓库，push 即自动构建上线）

纯静态、零后端、**零硬编码**：作者信息、项目条目、本站源码地址全部由 GitHub API 实时获取；内容与代码分离，改内容不碰代码。

## 站主

作者名称、简介、头像实时同步自 GitHub，站内不写死任何创作者信息。更换 GitHub 资料后，站点自动跟随。

## 架构

```
index.html        页面骨架与主题预加载
css/style.css     设计系统（档案纸墨配色、纯 CSS 入场动效、响应式）
js/api.js         数据层：stale-while-revalidate + ETag 条件请求
js/app.js         入口层：状态、路由、两阶段加载、事件委托
js/render.js      渲染层：卡片、模态、Markdown、wikilink 引用
data/entries.json 本地条目（唯一数据源）
```

## 数据同步机制

采用 **stale-while-revalidate** 策略：每次加载都发请求（带 ETag），服务器返回 304 则零开销续期，返回 200 则更新缓存。缓存仅用于首次秒开和网络失败兜底。

1. **ETag 条件请求**：带 `If-None-Match` 请求 GitHub API，数据未变返回 304，不消耗配额且自动续期
2. **持久缓存**：localStorage 存储，带 ETag 和过期时间戳；过期超 7 天自动丢弃
3. **空值过滤**：缓存不存空结果，防止错误数据覆盖正确数据
4. **降级兜底**：请求失败/限流时回退缓存，GitHub 不可用也能完整浏览

项目条目由 `GET /users/{user}/repos` 一次性同步（含本站仓库信息），单次刷新仅 3 个请求。

## 维护方式

- **添加本地条目**：编辑 `data/entries.json`，编号按 `OW-xxx` 递增，push 后自动生效
- **项目条目**：GitHub 仓库 push 后自动出现在站点
