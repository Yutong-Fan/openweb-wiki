# openweb.wiki — 开放网络知识库

协议文档气质的个人 Wiki。**内容零硬编码**：人工条目在 JSON，项目条目从 GitHub API 实时同步。

## 文件结构（三层架构）

```
openweb-wiki/
├── index.html          # 骨架（作者名占位，JS 填充）
├── css/style.css       # 设计系统（双主题变量）
├── js/
│   ├── api.js          # 数据层：GitHub API（作者+项目）+ 本地条目，零硬编码
│   ├── render.js       # 渲染层：卡片/模态/筛选/作者填充/模板替换
│   └── app.js          # 入口层：状态/主题/搜索/路由/事件
└── data/entries.json   # 人工条目（笔记/关于）
```

## 数据来源（全 API 驱动，零硬编码）

1. **作者信息** — `users/Yutong-Fan` API 自动获取（name/bio），
   hero 标题、页脚署名、页面 title、关于条目（`{{author}}` 占位符）全部动态填充。
   API 不可用时回退到默认值。

2. **项目条目** — `users/Yutong-Fan/repos` API 实时同步，
   新增/改名/加 star/挂官网全部自动跟进。（GitHub 公开 API 不返回私有仓库。）

3. **人工条目** — `data/entries.json`，笔记/关于等手动维护内容，
   支持 `{{author}}` 占位符与 `[[条目ID]]` 互链。

## 本地预览

minis:// 协议下 fetch 不可用，用本地 HTTP 服务预览：

```sh
cd openweb-wiki && python3 -m http.server 8901
# 浏览器打开 http://localhost:8901
```

## 部署

纯静态站，任意静态托管即可（GitHub Pages / Cloudflare Pages / Vercel）。
域名指向 openweb.wiki 后无需任何改动——卡片上的条目地址
`openweb.wiki/entries/OW-001` 会自动匹配域名。

## 功能

- **条目互链**：正文写 `[[KernelSU-Web]]`（条目 ID 或标题），自动转成 wiki 链接，点击跳转
- **条目地址直达**：`openweb.wiki/entries/OW-001`（或 `#/entries/OW-001`）直接打开该条目；浏览器前进/后退可关闭/重开模态
- **模态内全局搜索**：条目详情页可搜索全部条目，结果即时跳转
- **标签筛选**：点击卡片或模态里的标签，自动按标签搜索
- **搜索 / 分类**：实时过滤 + 分类 chips，切换时卡片交错重新入场
- **返回顶部**：滚动超过 600px 出现，平滑回顶（reduced-motion 时瞬时）
- **复制地址**：每条目可一键复制 URI（clipboard API + execCommand 降级）
- **夜间模式**：跟随系统 + 手动切换 + localStorage 记住 + 防闪烁；
  图标显隐由 CSS 纯控制（永不双显），切换时全站 0.35s 颜色过渡 + 图标旋转
- **字号自适应**：根字号 `clamp(15px, 0.875rem + 0.35vw, 18px)` 随视口自动缩放，
  全站 rem 布局与图标（em）同步适配，无需手动调节
- **dialog 降级**：不支持 `<dialog>` 的浏览器自动降级为 fixed 遮罩层

## 项目条目（GitHub 同步）

- **官网链接**：仓库 homepage 字段自动读取（如 KernelSU-Web → kernelsu.openweb.wiki），
  卡片地址行优先显示官网域名，详情页并列展示官网 + GitHub 两个链接（自动补全 https://）
- **star 计数**：首屏卡片直接显示 ⭐ 星标数，详情页正文含语言/星标/更新时间

## 设计（v3）

- 方向：现代开发者美学 —— slate 灰蓝 + teal 青绿体系（Vercel/Stripe 系成熟配色）
- 配色：浅色 `#F6F7F9` 底 + 白卡 + teal `#0E9384` 主色；
  深色护眼向：暖炭底 `#16161A` + 低亮度暖灰文字 `#C9C6C1`（10.6:1）+
  沉稳青灰主色 `#63A79F`（6.5:1），无高亮白、无荧光色
- 字体：系统字体栈（中文渲染最干净），等宽只留给 ID/日期/star 元数据
- 字号：正文 16px 基准不缩水，标题 clamp 适度缩放
- 布局：sticky 毛玻璃 header（logo+搜索+主题一行）→ hero 一行 → 分类 pill →
  auto-fill 卡片网格（300px 起，1→2→3 列平滑过渡）
- 卡片：12px 圆角、轻阴影、hover 提升 3px；元数据（ID/日期/分类/star）一目了然
- 动画：卡片入场 stagger + hover 提升，主题切换 0.3s 全站颜色过渡 + 图标旋转，克制不堆砌
- 无障碍：focus-visible 焦点环、skip-link、aria-live、触摸目标 ≥40px、
  `prefers-reduced-motion` 归零、对比度 AA
- 图标：Lucide SVG sprite，em 单位随字号缩放

## 站主

openweb.wiki 是 **Yutong Fan** 的个人开放知识库 —— 知识开放共享，站主有署名。
