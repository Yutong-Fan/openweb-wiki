/* 数据层：GitHub API 与本地条目
   策略：stale-while-revalidate — 每次加载都发请求（带 ETag），服务器返回 304 则零开销续期，
   返回 200 则更新缓存。缓存仅用于：首次秒开、304 续期、网络失败兜底。
   不再以 TTL 决定"要不要请求"，TTL 只表示"缓存新鲜度"供界面层参考。 */

window.WikiAPI = (function () {
  "use strict";

  var GH_USER = "Yutong-Fan";
  var GH_API = "https://api.github.com";
  var ENTRIES_URL = "data/entries.json";
  var CACHE_PREFIX = "ow-cache:";
  var TIMEOUT = 5000;

  /* TTL 仅标记缓存新鲜度，不阻止请求 */
  var TTL = {
    author: 86400000,
    repoList: 21600000,
    readme: 86400000,
    repoReadme: 86400000,
    entries: 300000
  };

  /* 过期超过此时长的缓存直接丢弃，不作为兜底 */
  var MAX_AGE = 7 * 86400000;

  var rateFlag = false;

  /* ── 工具 ── */

  function fmtDate(iso) {
    if (!iso) return "";
    if (iso.length === 10 && iso.charAt(4) === "-" && iso.charAt(7) === "-") return iso;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function normHomepage(raw) {
    if (!raw) return { clean: "", href: "" };
    var clean = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
    var href = /^https?:\/\//.test(raw) ? raw : "https://" + raw;
    return { clean: clean, href: href };
  }

  function isEmpty(val) {
    return val == null || val === "" ||
      (Array.isArray(val) && val.length === 0) ||
      (typeof val === "object" && !Array.isArray(val) && Object.keys(val).length === 0);
  }

  /* ── 缓存 ── */

  function cachePeek(key) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function cacheFresh(key) {
    var box = cachePeek(key);
    return box && box.exp > Date.now() ? box.v : null;
  }

  function cacheStale(key) {
    var box = cachePeek(key);
    if (!box || box.v == null) return null;
    if (box.exp + MAX_AGE < Date.now()) {
      try { localStorage.removeItem(CACHE_PREFIX + key); } catch (e) {}
      return null;
    }
    return box.v;
  }

  function cacheSet(key, value, ttlMs, etag) {
    if (isEmpty(value)) {
      try { localStorage.removeItem(CACHE_PREFIX + key); } catch (e) {}
      return;
    }
    try {
      localStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ v: value, exp: Date.now() + ttlMs, etag: etag || null })
      );
    } catch (e) {}
  }

  function cacheTouch(key, ttlMs) {
    var box = cachePeek(key);
    if (!box) return;
    box.exp = Date.now() + ttlMs;
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(box)); } catch (e) {}
  }

  /* ── 网络 ── */

  async function fetchWithTimeout(url, options, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || TIMEOUT);
    try {
      return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  /* 条件请求：始终发请求，带 ETag 则 If-None-Match。
     304 → 续期缓存并返回旧值；200 → 返回新值并缓存；其他 → 抛错 */
  async function fetchWithEtag(key, ttlMs, url, options, asText) {
    var box = cachePeek(key);
    var headers = Object.assign({}, options && options.headers);
    if (box && box.etag) headers["If-None-Match"] = box.etag;
    var r = await fetchWithTimeout(url, Object.assign({}, options, { headers }));

    if (r.status === 304 && box) {
      cacheTouch(key, ttlMs);
      return { value: box.v, etag: box.etag };
    }
    if (!r.ok) {
      var err = new Error("HTTP " + r.status);
      err.status = r.status;
      if (r.status === 403 &&
          String(r.headers.get("X-RateLimit-Remaining") || "").trim() === "0") {
        err.rateLimited = true;
      }
      throw err;
    }
    var val = asText ? await r.text() : await r.json();
    var newEtag = r.headers.get("ETag") || null;
    cacheSet(key, val, ttlMs, newEtag);
    return { value: val, etag: newEtag };
  }

  /* 包装器：始终请求，失败时回退缓存。
     缓存始终存原始 API 数据（raw），transform 只在返回给调用方时执行一次，
     避免 304 返回已 transform 的数据被再次 transform 导致结构错误。 */
  async function fetchOrStale(key, ttlMs, url, options, asText, transform) {
    try {
      var raw = await fetchWithEtag(key, ttlMs, url, options, asText);
      var val = transform ? transform(raw.value) : raw.value;
      return { value: val, fresh: true };
    } catch (e) {
      if (e && e.rateLimited) rateFlag = true;
      var stale = cacheStale(key);
      if (stale && transform) stale = transform(stale);
      return { value: stale, fresh: false };
    }
  }

  /* ── 仓库 → 条目映射 ── */

  function mapRepo(repo) {
    var hp = normHomepage(repo.homepage);
    return {
      id: repo.name,
      date: fmtDate(repo.pushed_at),
      category: "项目",
      tags: [repo.language, "github"].filter(Boolean),
      title: repo.name,
      summary: repo.description || "（无描述）",
      body: (repo.description ? repo.description + "\n\n" : "") +
        "语言：" + (repo.language || "—") +
        " · 星标：" + repo.stargazers_count +
        " · 最近更新：" + fmtDate(repo.pushed_at),
      source: hp.clean || "github.com/" + GH_USER + "/" + repo.name,
      url: repo.html_url,
      homepage: hp.href,
      stars: repo.stargazers_count || 0
    };
  }

  /* ── 数据接口 ── */

  async function getAuthor() {
    return fetchOrStale("author", TTL.author, GH_API + "/users/" + GH_USER, null, false, function (raw) {
      return {
        name: raw.name || raw.login,
        login: raw.login,
        bio: raw.bio || "",
        avatar: raw.avatar_url || ""
      };
    });
  }

  async function getRepoList() {
    var res = await fetchOrStale(
      "repoList", TTL.repoList,
      GH_API + "/users/" + GH_USER + "/repos?sort=pushed&per_page=100",
      null, false, function (repos) {
        var list = Array.isArray(repos) ? repos : [];
        var siteRepo = null;
        var projects = [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].name === "openweb-wiki") { siteRepo = list[i]; }
          else if (!list[i].fork && !list[i].private) { projects.push(mapRepo(list[i])); }
        }
        var site = null;
        if (siteRepo) {
          var hp = normHomepage(siteRepo.homepage);
          site = {
            source: "github.com/" + siteRepo.full_name,
            url: siteRepo.html_url,
            homepage: hp.href
          };
        }
        return { projects: projects, site: site };
      }
    );
    if (!res.value) res.value = { projects: [], site: null };
    return res;
  }

  async function getReadme() {
    var res = await fetchOrStale(
      "readme", TTL.readme,
      GH_API + "/repos/" + GH_USER + "/openweb-wiki/readme",
      { headers: { Accept: "application/vnd.github.raw+json" } }, true
    );
    if (res.value == null) res.value = "";
    return res;
  }

  async function getRepoReadme(repoName) {
    var res = await fetchOrStale(
      "readme:" + repoName, TTL.repoReadme,
      GH_API + "/repos/" + GH_USER + "/" + encodeURIComponent(repoName) + "/readme",
      { headers: { Accept: "application/vnd.github.raw+json" } }, true
    );
    if (res.value == null) res.value = "";
    return res;
  }

  /* 本地条目：始终 no-cache 请求，失败回退缓存 */
  async function getEntries() {
    try {
      var r = await fetchWithTimeout(ENTRIES_URL, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      var arr = await r.json();
      if (!Array.isArray(arr)) arr = [];
      cacheSet("entries", arr, TTL.entries);
      return { value: arr, fresh: true };
    } catch (e) {
      var stale = cacheStale("entries");
      return { value: Array.isArray(stale) ? stale : null, fresh: false };
    }
  }

  /* 聚合：并行请求，任一成功即 fresh */
  async function getRemote() {
    rateFlag = false;
    var results = await Promise.all([getAuthor(), getRepoList(), getReadme()]);
    var authorRes = results[0], repoRes = results[1], readmeRes = results[2];
    var author = authorRes.value;
    var repoData = repoRes.value || { projects: [], site: null };
    var projects = repoData.projects || [];
    var site = repoData.site || null;
    var readme = readmeRes.value || "";
    var anyFresh = authorRes.fresh || repoRes.fresh || readmeRes.fresh;

    return {
      author: author,
      projects: projects,
      site: site,
      readme: readme,
      ok: author != null || projects.length > 0 || site != null,
      fresh: anyFresh,
      rateLimited: rateFlag
    };
  }

  return {
    getEntries: getEntries,
    getRemote: getRemote,
    getRepoReadme: getRepoReadme,
    cacheFresh: cacheFresh,
    GH_USER: GH_USER,
    TTL: TTL
  };
})();
