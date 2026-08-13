# openweb.wiki

**Yutong Fan 的个人知识库** —— 项目、笔记、折腾记录，每条知识都有自己的地址。

- 在线站点：<https://openweb.wiki>
- 源码仓库：<https://github.com/Yutong-Fan/openweb-wiki>
- 部署方式：Cloudflare Pages（连接 GitHub 仓库，push 即自动构建上线）

纯静态、零后端、**零硬编码**：作者信息、项目条目、本站源码地址全部由 GitHub API 实时获取；内容与代码分离，改内容不碰代码。

## 站主

**Yutong Fan** · 个人知识库，条目开放共享。

## 架构

- `index.html` —— 页面骨架与主题预加载
- `css/style.css` —— 设计系统与动效（渐变主色、玻璃态、入场动画、响应式）
- `js/api.js` —— 数据层：GitHub API 同步 + 持久缓存 + 降级兜底
- `js/app.js` —— 入口层：状态、路由、两阶段加载、滚动显现
- `js/render.js` —— 渲染层：卡片、模态、Markdown
- `data/entries.json` —— 本地条目（唯一数据源）

## 数据同步机制

GitHub API 未认证限额为 60 次/小时/出口 IP，站点做了三层防护：

1. **持久缓存**：作者、仓库列表、README 均写入 localStorage，TTL 内零网络请求
2. **ETag 条件请求**：缓存过期后带 `If-None-Match` 请求，数据未变返回 304，不消耗配额且自动续期
3. **降级兜底**：请求失败/限流时自动回退上次缓存数据，GitHub 不可用也能完整浏览

项目条目由 `GET /users/{user}/repos` 一次性同步（含本站仓库信息），单次刷新仅 3 个请求。

## 维护方式

- **添加本地条目**：编辑 `data/entries.json`，编号按 `OW-xxx` 递增，push 后自动生效
- **强制刷新远端数据**：打开 `https://openweb.wiki/?force=1`（清缓存后重新同步）
- **项目条目**：GitHub 仓库 push 后自动出现在站点（有 6 小时缓存延迟）
