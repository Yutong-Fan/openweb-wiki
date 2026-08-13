/* 数据层：GitHub API 与本地条目
   GitHub API 未认证限额 60 次每小时每出口 IP，Cloudflare Pages 共享出口极易耗尽。
   本层用三层策略守护配额并保证站点永不空白：
   一 持久缓存 localStorage 加 TTL，缓存有效期内零网络请求
   二 ETag 条件请求，数据未变返回 304，不消耗配额并自动续期
   三 降级兜底，请求失败或限流时回退旧缓存，即使 GitHub 完全不可用也能浏览 */

window.WikiAPI = (function () {
  "use strict";

  const GH_USER = "Yutong-Fan";
  const GH_API = "https://api.github.com";
  const ENTRIES_URL = "data/entries.json";
  const CACHE_PREFIX = "ow-cache:";
  const TIMEOUT = 5000;

  const TTL = {
    author: 86400000,
    repoList: 21600000,
    readme: 86400000,
    repoReadme: 86400000,
    entries: 86400000
  };

  /* 配额耗尽标记，由 getRemote 汇总后透传给界面层 */
  let rateFlag = false;

  function fmtDate(iso) {
    if (!iso) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  /* 缓存箱结构为 { v: 值, exp: 过期时间戳, etag: 可选 } */

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
    } catch (e) {
      /* 隐私模式或存储配额满时静默跳过 */
    }
  }

  function cacheTouch(key, ttlMs) {
    const box = cachePeek(key);
    if (!box) return;
    box.exp = Date.now() + ttlMs;
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(box));
    } catch (e) {}
  }

  async function fetchWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || TIMEOUT);
    try {
      return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  /* 条件请求：缓存有 ETag 则带 If-None-Match，命中 304 续期并返回旧值。
     200 时返回新值与新 ETag，由调用方缓存。403 且配额归零时抛错并标记限流 */
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
      ) {
        err.rateLimited = true;
      }
      throw err;
    }
    return {
      value: asText ? await r.text() : await r.json(),
      stale: false,
      etag: r.headers.get("ETag") || null
    };
  }

  /* force 只表示跳过 TTL 强制发请求，不删除旧缓存，
     因此请求失败时仍能回退旧值，不会把数据弄丢 */

  async function getAuthor(force) {
    if (!force) {
      const hit = cacheGet("author");
      if (hit != null) return hit;
    }
    try {
      const r = await fetchWithEtag("author", TTL.author, GH_API + "/users/" + GH_USER);
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
      return stale && stale.v != null ? stale.v : null;
    }
  }

  /* 仓库列表一次取回项目与本站仓库信息，省去独立请求 */
  async function getRepoList(force) {
    if (!force) {
      const hit = cacheGet("repoList");
      if (hit != null) return hit;
    }
    try {
      const r = await fetchWithEtag(
        "repoList",
        TTL.repoList,
        GH_API + "/users/" + GH_USER + "/repos?sort=pushed&per_page=100"
      );
      const repos = Array.isArray(r.value) ? r.value : [];
      const siteRepo = repos.find(function (x) {
        return x.name === "openweb-wiki";
      }) || null;

      const projects = repos
        .filter(function (x) {
          return !x.fork && !x.private && x.name !== "openweb-wiki";
        })
        .map(function (repo) {
          const rawHome = repo.homepage || "";
          const home = rawHome.replace(/^https?:\/\//, "").replace(/\/$/, "");
          const homeHref = /^https?:\/\//.test(rawHome)
            ? rawHome
            : "https://" + rawHome;
          return {
            id: repo.name,
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
      const stale = cachePeek("repoList");
      return stale && stale.v != null ? stale.v : { projects: [], site: null };
    }
  }

  async function getReadme(force) {
    if (!force) {
      const hit = cacheGet("readme");
      if (hit != null) return hit;
    }
    try {
      const r = await fetchWithEtag(
        "readme",
        TTL.readme,
        GH_API + "/repos/" + GH_USER + "/openweb-wiki/readme",
        { headers: { Accept: "application/vnd.github.raw+json" } },
        true
      );
      cacheSet("readme", r.value, TTL.readme, r.etag);
      return r.value;
    } catch (e) {
      if (e && e.rateLimited) rateFlag = true;
      const stale = cachePeek("readme");
      return stale && stale.v != null ? stale.v : "";
    }
  }

  /* 项目 README 按需拉取，缓存键按仓库隔离 */
  async function getRepoReadme(repoName, force) {
    const key = "readme:" + repoName;
    if (!force) {
      const hit = cacheGet(key);
      if (hit != null) return hit;
    }
    try {
      const r = await fetchWithEtag(
        key,
        TTL.repoReadme,
        GH_API + "/repos/" + GH_USER + "/" + encodeURIComponent(repoName) + "/readme",
        { headers: { Accept: "application/vnd.github.raw+json" } },
        true
      );
      cacheSet(key, r.value, TTL.repoReadme, r.etag);
      return r.value;
    } catch (e) {
      if (e && e.rateLimited) rateFlag = true;
      const stale = cachePeek(key);
      return stale && stale.v != null ? stale.v : "";
    }
  }

  /* 本地条目唯一数据源为 entries.json，网络失败时回退本地副本 */
  async function getEntries() {
    try {
      const r = await fetchWithTimeout(ENTRIES_URL, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      const arr = Array.isArray(data) ? data : [];
      cacheSet("entries", arr, TTL.entries);
      return arr;
    } catch (e) {
      const stale = cachePeek("entries");
      return stale && Array.isArray(stale.v) ? stale.v : null;
    }
  }

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
    return {
      author: author,
      projects: projects,
      site: site,
      readme: readme,
      ok: ok,
      rateLimited: rateFlag
    };
  }

  return {
    getAuthor: getAuthor,
    getRepoList: getRepoList,
    getReadme: getReadme,
    getRepoReadme: getRepoReadme,
    getEntries: getEntries,
    getRemote: getRemote,
    GH_USER: GH_USER,
    TTL: TTL
  };
})();
