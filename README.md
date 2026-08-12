# openweb.wiki

**Yutong Fan 的个人知识库** —— 项目、笔记、折腾记录，每条知识都有自己的地址。

**在线站点：<https://openweb.wiki>**

纯静态、零后端、**零硬编码**：作者信息与项目条目全部由 GitHub API 实时同步，人工条目单独维护。改内容不用碰代码。

---

## 文件结构（三层架构）

```
openweb-wiki/
├── index.html          # 页面骨架（作者名占位，JS 填充）
├── css/style.css       # 设计系统（双主题 CSS 变量）
├── js/
│   ├── api.js          # 📡 数据层：GitHub API + 本地条目，零硬编码
│   ├── render.js       # 🎨 渲染层：纯函数渲染（卡片/模态/筛选/模板）
│   └── app.js          # ⚙️ 入口层：状态 / 主题 / 路由 / 事件
├── data/
│   └── entries.json    # 人工条目（笔记 / 关于）
└── README.md
```

## 数据来源（全 API 驱动）

| 数据 | 来源 | 说明 |
|---|---|---|
| 作者信息 | `users/Yutong-Fan` API | 名字 / bio 实时获取，hero 标题、页脚、页面 title 自动填充 |
| 项目条目 | `users/Yutong-Fan/repos` API | 新增 / 改名 / 加 star / 挂官网全部自动同步；公开 API 不返回私有仓库 |
| 人工条目 | `data/entries.json` | 笔记 / 关于等手动维护内容 |

人工条目支持两种模板语法：

- `{{author}}` —— 渲染时替换为 API 获取的作者名
- `[[条目ID]]` 或 `[[条目标题]]` —— wiki 互链，点击在站内跳转

## 维护：添加一条笔记

编辑 `data/entries.json`，在数组中加一个对象，保存后**刷新页面即生效**：

```json
{
  "id": "OW-002",
  "date": "2026-08-12",
  "category": "笔记",
  "tags": ["标签1"],
  "title": "条目标题",
  "summary": "卡片上的一句话摘要",
  "body": "点开后的全文。\n\n空行分段，支持 [[OW-001]] 互链和 {{author}} 占位。"
}
```

`category` 会自动生成筛选按钮（顺序：项目 > 笔记 > 灵感 > 阅读 > 折腾 > 关于）。

## 功能

- **条目互链**：正文 `[[条目]]` 转 wiki 链接，点击站内跳转
- **条目地址直达**：`openweb.wiki/entries/OW-001`（或 `#/entries/OW-001`）直接打开对应条目，浏览器前进/后退联动
- **模态内全局搜索**：详情页可搜全部条目，结果即时跳转
- **标签筛选**：点击卡片 / 模态里的标签，自动按标签过滤
- **搜索 / 分类**：实时过滤 + 分类 chips，切换时卡片交错入场
- **返回顶部**：滚动超 600px 出现，平滑回顶
- **复制地址**：每条目一键复制 URI（clipboard API + execCommand 降级）
- **夜间模式**：跟随系统 + 手动切换 + localStorage 记住 + 防闪烁（CSS 纯控制图标显隐，永不双显）
- **dialog 降级**：不支持 `<dialog>` 的浏览器自动降级为 fixed 遮罩

## 本地预览

minis:// 等环境下 fetch 受限，用本地 HTTP 服务：

```sh
cd openweb-wiki && python3 -m http.server 8901
# 打开 http://localhost:8901
```

## 部署

纯静态站，任意静态托管即可：

```sh
# Cloudflare Pages 连接 GitHub 仓库自动部署
# 仓库：github.com/Yutong-Fan/openweb-wiki
# 站点：https://openweb.wiki
```

绑定自有域名（如 openweb.wiki）后在仓库 Settings → Pages 配置 Custom domain，
卡片上的条目地址会自动匹配。

## 设计

- **方向**：现代开发者美学 —— slate 灰蓝 + teal 青绿（同色相双主题）
- **浅色**：底 `#F6F7F9` / 卡 `#FFFFFF` / 文字 `#101828` / 主色 teal `#0E9384`
- **深色**：底 `#121212`（纯中性）/ 卡 `#1E1E1E` / 文字 `#E8E8E8`（15.3:1）/
  主色压灰 teal `#7FB5AE`（8.1:1）—— 同色相暗化，无荧光、不刺眼
- **字体**：系统字体栈（中文渲染最干净），等宽仅用于 ID / 日期 / star 元数据
- **布局**：sticky 毛玻璃 header → hero 一行 → 分类 pill → auto-fill 卡片网格
  （300px 起，1 → 2 → 3 列平滑过渡）
- **卡片**：12px 圆角、轻阴影、hover 上浮 3px
- **动画**：卡片入场 stagger + hover 提升 + 主题切换 0.3s 颜色过渡，克制不堆砌
- **无障碍**：focus-visible 焦点环、skip-link、aria-live、触摸目标 ≥40px、
  `prefers-reduced-motion` 归零、对比度 AA
- **图标**：Lucide SVG sprite（禁 emoji），em 单位随字号缩放

## 站主

**Yutong Fan** · 个人知识库，条目开放共享。
