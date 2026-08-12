/* 人工条目（由 entries.json 生成，script 标签加载，不依赖 fetch） */
window.WIKI_ENTRIES = [
  {
    "id": "OW-001",
    "date": "2026-08-12",
    "category": "关于",
    "tags": [
      "本站"
    ],
    "title": "关于本站",
    "summary": "openweb.wiki 是 {{author}} 的个人知识库，收录项目、笔记和折腾记录。",
    "body": "openweb.wiki 是 {{author}} 的个人知识库，收录项目、笔记和折腾记录。\n\n本站源码托管在 GitHub，完整说明（架构、数据来源、维护方式、功能列表）直接同步自仓库 README，见下方「仓库 README」区块。\n\n条目开放共享：每条都有独立地址，可以被引用、分发、检查。项目条目由 GitHub API 实时自动同步，笔记类条目维护在 data/entries.json 里。正文用 [[条目ID]] 写引用，可以跳转到对应条目。\n\n添加内容：在 data/entries.json 的数组中加一条记录，编号按 OW-xxx 递增，保存后刷新即生效。"
  }
];
