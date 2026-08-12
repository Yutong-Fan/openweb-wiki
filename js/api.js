/* 数据层：所有数据来自远程 API，零硬编码
   - 作者信息：GitHub users API
   - 项目条目：GitHub repos API（实时同步）
   - 人工条目：data/entries.json（本地维护） */

window.WikiAPI = (function () {
  "use strict";

  const GH_USER = "Yutong-Fan";
  const ENTRIES_URL = "data/entries.json";
  const GH_API = "https://api.github.com";

  /* ---------- 作者信息 ---------- */

  async function getAuthor() {
    try {
      const r = await fetch(`${GH_API}/users/${GH_USER}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const u = await r.json();
      return {
        name: u.name || u.login,
        login: u.login,
        bio: u.bio || "",
        avatar: u.avatar_url || ""
      };
    } catch (e) {
      return { name: "Yutong Fan", login: GH_USER, bio: "", avatar: "" };
    }
  }

  /* ---------- 项目条目（GitHub 实时同步） ---------- */

  async function getProjects() {
    try {
      const r = await fetch(
        `${GH_API}/users/${GH_USER}/repos?sort=updated&per_page=20`
      );
      if (!r.ok) throw new Error("HTTP " + r.status);
      const repos = await r.json();
      return repos
        .filter((x) => !x.fork && !x.private && x.name !== 'openweb-wiki')
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
    } catch (e) {
      return [];
    }
  }

  /* ---------- 人工条目 ---------- */

  async function getEntries() {
    try {
      const r = await fetch(ENTRIES_URL, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  return { getAuthor, getProjects, getEntries, GH_USER };
})();
