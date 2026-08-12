/* 数据层：GitHub API + 本地条目，零硬编码
   - 缓存：sessionStorage + TTL，避免重复请求与 API 限流
   - 降级：任何远端失败返回安全默认值，不阻塞渲染
   - 组合：两阶段加载 —— 本地条目立即可用，远端数据后补 */

window.WikiAPI = (function () {
  "use strict";

  const GH_USER = "Yutong-Fan";
  const GH_API = "https://api.github.com";
  const ENTRIES_URL = "data/entries.json";
  const CACHE_PREFIX = "ow-cache:";

  /* 缓存（sessionStorage + TTL） */

  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const box = JSON.parse(raw);
      if (box.exp < Date.now()) {
        sessionStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return box.value;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, value, ttlMs) {
    try {
      sessionStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ value: value, exp: Date.now() + ttlMs })
      );
    } catch (e) { /* 存储不可用则跳过 */ }
  }

  /* 基础请求（带超时，防挂起） */

  async function fetchWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 8000);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJSON(url, options) {
    const r = await fetchWithTimeout(url, options);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function withCache(key, ttlMs, fetcher) {
    const hit = cacheGet(key);
    if (hit != null) return hit;
    const value = await fetcher();
    cacheSet(key, value, ttlMs);
    return value;
  }

  /* 作者信息（TTL 1 天） */

  async function getAuthor(force) {
    if (force) sessionStorage.removeItem(CACHE_PREFIX + "author");
    try {
      return await withCache("author", 86400000, async () => {
        const u = await fetchJSON(`${GH_API}/users/${GH_USER}`);
        return {
          name: u.name || u.login,
          login: u.login,
          bio: u.bio || "",
          avatar: u.avatar_url || ""
        };
      });
    } catch (e) {
      return null;
    }
  }

  /* 项目条目（TTL 5 分钟） */

  async function getProjects(force) {
    if (force) sessionStorage.removeItem(CACHE_PREFIX + "projects");
    try {
      return await withCache("projects", 300000, async () => {
        const repos = await fetchJSON(
          `${GH_API}/users/${GH_USER}/repos?sort=updated&per_page=20`
        );
        return repos
          /* 排除站点自身仓库：不单独成卡，其源码地址由 getSiteRepo 融合 */
          .filter((x) => !x.fork && !x.private && x.name !== "openweb-wiki")
          .map((repo) => {
            const rawHome = repo.homepage || "";
            const home = rawHome.replace(/^https?:\/\//, "").replace(/\/$/, "");
            const homeHref = /^https?:\/\//.test(rawHome)
              ? rawHome
              : "https://" + rawHome;
            return {
              id: repo.name,
              date: (repo.updated_at || "").slice(0, 10),
              category: "项目",
              tags: [repo.language, "github"].filter(Boolean),
              title: repo.name,
              summary: repo.description || "（无描述）",
              body:
                (repo.description ? repo.description + "\n\n" : "") +
                `语言：${repo.language || "—"} · 星标：${repo.stargazers_count} · 最近更新：${(repo.updated_at || "").slice(0, 10)}`,
              source: home || `github.com/${GH_USER}/${repo.name}`,
              url: repo.html_url,
              homepage: homeHref,
              stars: repo.stargazers_count || 0
            };
          });
      });
    } catch (e) {
      return [];
    }
  }

  /* 本站源码仓库（TTL 1 天，融合进「关于本站」） */

  async function getSiteRepo(force) {
    if (force) sessionStorage.removeItem(CACHE_PREFIX + "siteRepo");
    try {
      return await withCache("siteRepo", 86400000, async () => {
        const repo = await fetchJSON(`${GH_API}/repos/${GH_USER}/openweb-wiki`);
        const hp = repo.homepage || "";
        return {
          source: `github.com/${repo.full_name}`,
          url: repo.html_url,
          homepage: /^https?:\/\//.test(hp) ? hp : hp ? "https://" + hp : ""
        };
      });
    } catch (e) {
      return null;
    }
  }

  /* 本站 README（TTL 30 分钟） */

  async function getReadme(force) {
    if (force) sessionStorage.removeItem(CACHE_PREFIX + "readme");
    try {
      return await withCache("readme", 1800000, async () => {
        const r = await fetchWithTimeout(
          `${GH_API}/repos/${GH_USER}/openweb-wiki/readme`,
          { headers: { Accept: "application/vnd.github.raw+json" } }
        );
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.text();
      });
    } catch (e) {
      return "";
    }
  }

  /* 人工条目：优先 script 标签注入（不依赖 fetch，永不挂起），fetch 仅兜底 */

  async function getEntries() {
    if (Array.isArray(window.WIKI_ENTRIES) && window.WIKI_ENTRIES.length) {
      return window.WIKI_ENTRIES;
    }
    try {
      const r = await fetchWithTimeout(ENTRIES_URL, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  /* 远端数据组合（两阶段加载的第二阶段） */

  async function getRemote() {
    const [author, projects, site, readme] = await Promise.all([
      getAuthor(),
      getProjects(),
      getSiteRepo(),
      getReadme()
    ]);
    const ok = author != null || projects.length > 0 || site != null;
    return { author, projects, site, readme, ok };
  }

  return {
    getAuthor,
    getProjects,
    getSiteRepo,
    getReadme,
    getEntries,
    getRemote,
    GH_USER
  };
})();
