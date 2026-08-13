/* 数据层：GitHub API 和本地条目
   - 缓存：localStorage + TTL + ETag 条件请求
     · GitHub API 未认证限额 60 次/小时/出口 IP（Cloudflare Pages 共享出口，极易耗尽）
     · ETag 命中返回 304，不消耗配额，且自动续期缓存
     · TTL 内直接读缓存，零网络请求；配额只花在数据真正变化时
   - 降级：stale-while-revalidate —— 请求失败/限流时返回旧缓存，项目永不消失
   - 合并：仓库列表一次取回全部项目 + 本站仓库信息，单次同步仅 3 个请求
   - 数据源：本地条目唯一来源 data/entries.json（fetch + 本地副本兜底） */

window.WikiAPI = (function () {
  "use strict";

  const GH_USER = "Yutong-Fan";
  const GH_API = "https://api.github.com";
  const ENTRIES_URL = "data/entries.json";
  const CACHE_PREFIX = "ow-cache:";
  const TIMEOUT = 5000; /* 单请求超时，防挂起 */

  const TTL = {
    author: 86400000,          /* 作者 1 天 */
    repoList: 6 * 3600000,     /* 仓库列表 6 小时 */
    readme: 86400000,          /* 本站 README 1 天 */
    repoReadme: 86400000,      /* 项目 README 1 天 */
    entries: 86400000          /* 本地条目副本 1 天 */
  };

  /* ISO 时间转本地时区日期，纯日期原样返回，非法值兜底 */
  function fmtDate(iso) {
    if (!iso) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  /* ---------- 缓存（localStorage + TTL，箱结构 { v, exp, etag }） ---------- */

  function cachePeek(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function cacheGet(key) {
    const box = cachePeek(key);
    return box && box.exp > Date.now() ? box.v : null;
  }

  function cacheSet(key, value, ttlMs, etag) {
    try {
      localStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ v: value, exp: Date.now() + ttlMs, etag: etag || null })
      );
    } catch (e) { /* 存储不可用（隐私模式等）则跳过 */ }
  }

  function cacheTouch(key, ttlMs) {
    const box = cachePeek(key);
    if (!box) return;
    box.exp = Date.now() + ttlMs;
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(box)); } catch (e) {}
  }

  function cacheDrop(key) {
    try { localStorage.removeItem(CACHE_PREFIX + key); } catch (e) {}
  }

  /* ---------- 基础请求（带超时，防挂起） ---------- */

  async function fetchWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || TIMEOUT);
    try {
      return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  /* ETag 条件请求：
     - 缓存有 ETag 则带 If-None-Match，命中 304 续期缓存并返回旧值（不耗配额）
     - 200 时返回新值 + ETag，由调用方决定如何缓存
     - 403 且配额耗尽时抛错并标记 err.rateLimited */
  async function fetchWithEtag(key, ttlMs, url, options, asText) {
    const box = cachePeek(key);
    const headers = Object.assign({}, options && options.headers);
    if (box && box.etag) headers["If-None-Match"] = box.etag;
    const r = await fetchWithTimeout(url, Object.assign({}, options, { headers }));
    if (r.status === 304 && box) {
      cacheTouch(key, ttlMs);
      return { value: box.v, stale: true, etag: box.etag };
    }
    if (!r.ok) {
      const err = new Error("HTTP " + r.status);
      err.status = r.status;
      if (
        r.status === 403 &&
        String(r.headers.get("X-RateLimit-Remaining") || "").trim() === "0"
      ) err.rateLimited = true;
      throw err;
    }
    return {
      value: asText ? await r.text() : await r.json(),
      stale: false,
      etag: r.headers.get("ETag") || null
    };
  }

  /* 配额耗尽标记（供 getRemote 汇总） */
  let rateFlag = false;

  /* ---------- 作者信息（TTL 1 天 + ETag + 旧值兜底） ---------- */

  async function getAuthor(force) {
    if (force) cacheDrop("author");
    const hit = cacheGet("author");
    if (hit) return hit;
    try {
      const r = await fetchWithEtag(
        "author", TTL.author, GH_API + "/users/" + GH_USER
      );
      const u = {
        name: r.value.name || r.value.login,
        login: r.value.login,
        bio: r.value.bio || "",
        avatar: r.value.avatar_url || ""
      };
      cacheSet("author", u, TTL.author, r.etag);
      return u;
    } catch (e) {
      if (e && e.rateLimited) rateFlag = true;
      const stale = cachePeek("author");
      return stale && stale.v ? stale.v : null;
    }
  }

  /* ---------- 仓库列表（TTL 6 小时 + ETag + 旧值兜底）
     一次取回：项目条目 + 本站仓库信息，省去独立请求 ---------- */

  async function getRepoList(force) {
    if (force) cacheDrop("repoList");
    const hit = cacheGet("repoList");
    if (hit) return hit;
    try {
      const r = await fetchWithEtag(
        "repoList", TTL.repoList,
        GH_API + "/users/" + GH_USER + "/repos?sort=pushed&per_page=20"
      );
      const repos = Array.isArray(r.value) ? r.value : [];
      const siteRepo = repos.find(function (x) { return x.name === "openweb-wiki"; }) || null;

      const projects = repos
        /* 排除站点自身仓库与 fork/私有仓库 */
        .filter(function (x) { return !x.fork && !x.private && x.name !== "openweb-wiki"; })
        .map(function (repo) {
          const rawHome = repo.homepage || "";
          const home = rawHome.replace(/^https?:\/\//, "").replace(/\/$/, "");
          const homeHref = /^https?:\/\//.test(rawHome)
            ? rawHome
            : "https://" + rawHome;
          return {
            id: repo.name,
            /* pushed_at 是最后 push 代码的时间，updated_at 会被 star 等元数据活动污染 */
            date: fmtDate(repo.pushed_at),
            category: "项目",
            tags: [repo.language, "github"].filter(Boolean),
            title: repo.name,
            summary: repo.description || "（无描述）",
            body:
              (repo.description ? repo.description + "\n\n" : "") +
              "语言：" + (repo.language || "—") +
              " · 星标：" + repo.stargazers_count +
              " · 最近更新：" + fmtDate(repo.pushed_at),
            source: home || "github.com/" + GH_USER + "/" + repo.name,
            url: repo.html_url,
            homepage: homeHref,
            stars: repo.stargazers_count || 0
          };
        });

      const site = siteRepo
        ? (function () {
            const hp = siteRepo.homepage || "";
            return {
              source: "github.com/" + siteRepo.full_name,
              url: siteRepo.html_url,
              homepage: /^https?:\/\//.test(hp)
                ? hp
                : hp ? "https://" + hp : ""
            };
          })()
        : null;

      const data = { projects: projects, site: site };
      cacheSet("repoList", data, TTL.repoList, r.etag);
      return data;
    } catch (e) {
      if (e && e.rateLimited) rateFlag = true;
      /* 旧值兜底：即使 API 挂了，项目卡片也照常显示（数据可能稍旧） */
      const stale = cachePeek("repoList");
      return stale && stale.v ? stale.v : { projects: [], site: null };
    }
  }

  /* ---------- 本站 README（TTL 1 天 + ETag + 旧值兜底） ---------- */

  async function getReadme(force) {
    if (force) cacheDrop("readme");
    const hit = cacheGet("readme");
    if (hit != null) return hit;
    try {
      const r = await fetchWithEtag(
        "readme", TTL.readme,
        GH_API + "/repos/" + GH_USER + "/openweb-wiki/readme",
        { headers: { Accept: "application/vnd.github.raw+json" } },
        true
      );
      cacheSet("readme", r.value, TTL.readme, r.etag);
      return r.value;
    } catch (e) {
      if (e && e.rateLimited) rateFlag = true;
      const stale = cachePeek("readme");
      return stale && stale.v ? stale.v : "";
    }
  }

  /* ---------- 任意仓库 README（按需拉取，TTL 1 天，键名按仓库隔离） ---------- */

  async function getRepoReadme(repoName, force) {
    const key = "readme:" + repoName;
    if (force) cacheDrop(key);
    const hit = cacheGet(key);
    if (hit != null) return hit;
    try {
      const r = await fetchWithEtag(
        key, TTL.repoReadme,
        GH_API + "/repos/" + GH_USER + "/" + encodeURIComponent(repoName) + "/readme",
        { headers: { Accept: "application/vnd.github.raw+json" } },
        true
      );
      cacheSet(key, r.value, TTL.repoReadme, r.etag);
      return r.value;
    } catch (e) {
      if (e && e.rateLimited) rateFlag = true;
      const stale = cachePeek(key);
      return stale && stale.v ? stale.v : "";
    }
  }

  /* ---------- 本地条目（唯一数据源 entries.json；离线用本地副本） ---------- */

  async function getEntries() {
    try {
      const r = await fetchWithTimeout(ENTRIES_URL, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      const arr = Array.isArray(data) ? data : [];
      cacheSet("entries", arr, TTL.entries);
      return arr;
    } catch (e) {
      /* 网络不可用/请求失败：回退本地副本（可过期，总比空白好） */
      const stale = cachePeek("entries");
      return stale && Array.isArray(stale.v) ? stale.v : null;
    }
  }

  /* ---------- 远端数据组合（两阶段加载的第二阶段） ---------- */

  async function getRemote(force) {
    rateFlag = false;
    let author = null;
    let projects = [];
    let site = null;
    let readme = "";
    await Promise.all([
      getAuthor(force).then(function (a) { if (a) author = a; }),
      getRepoList(force).then(function (d) {
        if (d) { projects = d.projects || []; site = d.site || null; }
      }),
      getReadme(force).then(function (r) { if (r) readme = r; })
    ]);
    const ok = author != null || projects.length > 0 || site != null;
    return { author: author, projects: projects, site: site, readme: readme, ok: ok, rateLimited: rateFlag };
  }

  return {
    getAuthor: getAuthor,
    getRepoList: getRepoList,
    getProjects: getRepoList, /* 兼容旧调用名 */
    getReadme: getReadme,
    getRepoReadme: getRepoReadme,
    getEntries: getEntries,
    getRemote: getRemote,
    GH_USER: GH_USER,
    TTL: TTL
  };
})();
