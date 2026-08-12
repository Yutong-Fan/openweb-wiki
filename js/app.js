/* 入口层：状态管理 / 两阶段加载 / 主题 / 路由 / 事件
   阶段 1：本地条目立即渲染（秒开）
   阶段 2：GitHub 数据到达后合并渲染（渐进增强）
   数据来自 WikiAPI，渲染交给 WikiRender */

(function () {
  "use strict";

  const STORAGE_KEY = "ow-theme";
  const rootEl = document.documentElement;
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)");
  const supportsDialog = typeof HTMLDialogElement !== "undefined";

  const grid = document.getElementById("grid");
  const status = document.getElementById("status");
  const filtersEl = document.getElementById("filters");
  const searchInput = document.getElementById("search");
  const modal = document.getElementById("modal");
  const modalBody = document.getElementById("modal-body");
  const modalClose = document.getElementById("modal-close");
  const modalSearch = document.getElementById("modal-search");
  const modalResults = document.getElementById("modal-search-results");
  const footUri = document.getElementById("foot-uri");
  const themeToggle = document.getElementById("theme-toggle");
  const backTop = document.getElementById("back-top");
  const heroTitle = document.getElementById("author-name");
  const heroSub = document.getElementById("author-sub");
  const footNote = document.getElementById("foot-note");

  const R = window.WikiRender;

  /* 单一状态 */

  const store = {
    entries: [],
    author: null,
    readmeHtml: "",
    category: "全部",
    query: "",
    openId: null
  };

  /* 主题 */

  function currentTheme() {
    const t = rootEl.dataset.theme;
    if (t === "dark" || t === "light") return t;
    return sysDark.matches ? "dark" : "light";
  }

  function syncThemeIcon() {
    themeToggle.setAttribute(
      "aria-label",
      currentTheme() === "dark" ? "切换到浅色模式" : "切换到深色模式"
    );
  }

  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") rootEl.dataset.theme = saved;
    syncThemeIcon();
  }

  themeToggle.addEventListener("click", () => {
    rootEl.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, rootEl.dataset.theme); } catch (e) {}
    syncThemeIcon();
  });

  sysDark.addEventListener("change", () => {
    if (!localStorage.getItem(STORAGE_KEY)) syncThemeIcon();
  });

  /* 作者信息渲染 */

  function renderAuthor() {
    const name = (store.author && store.author.name) || "Yutong Fan";
    heroTitle.textContent = `${name} 的知识库`;
    heroSub.textContent =
      (store.author && store.author.bio) ||
      "项目、笔记、折腾记录 —— 每条知识都有自己的地址。";
    footNote.textContent = `${name} · 个人知识库，条目开放共享`;
    document.title = `openweb.wiki · ${name} 的知识库`;
  }

  /* 列表渲染 */

  function visibleEntries() {
    const q = store.query.trim().toLowerCase();
    return store.entries
      .filter(
        (e) => store.category === "全部" || e.category === store.category
      )
      .filter((e) => {
        if (!q) return true;
        return [e.id, e.title, e.summary, e.body, e.category, ...(e.tags || [])]
          .join(" ").toLowerCase().includes(q);
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function render() {
    const list = visibleEntries();
    R.grid(list, grid);
    const parts = [];
    if (list.length) parts.push(`${String(list.length).padStart(2, "0")} 条条目`);
    if (store.query) parts.push(`关键词「${store.query}」`);
    if (store.category !== "全部") parts.push(store.category);
    if (store.syncing) parts.push("正在同步 GitHub 数据…");
    if (store.remoteFailed) parts.push("GitHub 数据加载失败，仅显示本地条目");
    status.textContent = parts.join(" · ");
    footUri.textContent = R.BRAND;
  }

  /* 两阶段加载 */

  function mergeSiteRepo(local, site) {
    const about = local.find((e) => e.category === "关于");
    if (about && site) {
      about.source = site.source;
      about.url = site.url;
      about.homepage = site.homepage;
    }
  }

  function renderAll() {
    renderAuthor();
    filtersEl.innerHTML = R.filters(store.entries, store.category);
    render();
  }

  /* 看门狗：任何阶段卡住都能继续（防止挂起的请求阻塞整站） */
  function watchdog(ms, fallback) {
    return new Promise((resolve) =>
      setTimeout(() => resolve(fallback), ms)
    );
  }

  async function boot() {
    initTheme();

    /* 阶段 1：本地条目秒开（看门狗 6s 兜底） */
    store.syncing = true;
    grid.innerHTML = `<div class="empty">正在加载…</div>`;
    const local = await Promise.race([
      WikiAPI.getEntries(),
      watchdog(6000, [])
    ]);
    store.entries = local;
    renderAll();

    /* 阶段 2：GitHub 数据后补（看门狗 12s 兜底） */
    const remote = await Promise.race([
      WikiAPI.getRemote(),
      watchdog(12000, {
        author: null, projects: [], site: null, readme: "", ok: false
      })
    ]);
    store.syncing = false;
    if (!remote.ok) {
      store.remoteFailed = true;
    } else {
      if (remote.author) store.author = remote.author;
      if (remote.site) mergeSiteRepo(local, remote.site);
      if (remote.readme) {
        store.readmeHtml = R.mdToHtml(remote.readme);
      }
      store.entries = local.concat(remote.projects);
    }
    renderAll();
    routeFromHash();
  }

  /* 模态 */

  function openEntry(id) {
    const e = store.entries.find((x) => x.id === id);
    if (!e) return;
    R.modal(e, modalBody, store.entries, { author: store.author ? store.author.name : "" }, store.readmeHtml);
    store.openId = e.id;
    modalSearch.value = "";
    modalResults.classList.remove("is-open");
    if (supportsDialog) {
      modal.showModal();
    } else {
      modal.classList.add("is-fallback");
      modal.removeAttribute("hidden");
    }
    if (location.hash !== R.hashOf(e.id)) {
      history.pushState(null, "", R.hashOf(e.id));
    }
  }

  function closeModal() {
    if (supportsDialog) {
      if (modal.open) modal.close();
    } else if (!modal.hasAttribute("hidden")) {
      modal.setAttribute("hidden", "");
    }
    if (store.openId && location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    store.openId = null;
  }

  /* hash 路由 */

  function routeFromHash() {
    const m = location.hash.match(/^#\/?entries\/(.+)$/i);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (store.entries.some((e) => e.id === id)) openEntry(id);
    }
  }

  window.addEventListener("popstate", () => {
    if (!location.hash) closeModal();
    else routeFromHash();
  });

  /* 模态搜索 */

  function renderModalResults(q) {
    const qq = q.trim().toLowerCase();
    if (!qq) {
      modalResults.classList.remove("is-open");
      return;
    }
    const hits = store.entries
      .filter((e) =>
        [e.id, e.title, e.summary, ...(e.tags || [])]
          .join(" ").toLowerCase().includes(qq)
      )
      .slice(0, 8);
    R.searchResults(hits, modalResults);
  }

  modalSearch.addEventListener("input", () =>
    renderModalResults(modalSearch.value)
  );
  modalSearch.addEventListener("focus", () => {
    if (modalSearch.value) renderModalResults(modalSearch.value);
  });
  modalSearch.addEventListener("blur", () =>
    setTimeout(() => { modalResults.classList.remove("is-open"); }, 150)
  );

  /* 事件 */

  document.addEventListener("click", (ev) => {
    const jump = ev.target.closest("[data-jump]");
    if (jump) {
      ev.stopPropagation();
      openEntry(jump.dataset.jump);
      return;
    }
    const copyBtn = ev.target.closest("[data-copy]");
    if (copyBtn) {
      ev.stopPropagation();
      copyText(copyBtn.dataset.copy)
        .then(() => showToast("已复制条目地址"))
        .catch(() => showToast("复制失败 · 可长按地址手动复制"));
      return;
    }
    const tagBtn = ev.target.closest("[data-tag]");
    if (tagBtn) {
      ev.stopPropagation();
      searchInput.value = tagBtn.dataset.tag;
      store.query = tagBtn.dataset.tag;
      store.category = "全部";
      filtersEl.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("is-active", c.dataset.filter === "全部")
      );
      render();
      return;
    }
    const wiki = ev.target.closest("[data-wiki]");
    if (wiki) {
      ev.preventDefault();
      openEntry(wiki.dataset.wiki);
      return;
    }
    if (ev.target.closest("a")) return;
    const card = ev.target.closest(".entry");
    if (card) openEntry(card.dataset.id);
  });

  grid.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      const card = ev.target.closest(".entry");
      if (card) {
        ev.preventDefault();
        openEntry(card.dataset.id);
      }
    }
  });

  filtersEl.addEventListener("click", (ev) => {
    const chip = ev.target.closest(".chip");
    if (!chip) return;
    store.category = chip.dataset.filter;
    filtersEl.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("is-active", c === chip)
    );
    render();
  });

  let debounce;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      store.query = searchInput.value;
      render();
    }, 120);
  });

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) closeModal();
  });
  modal.addEventListener("close", () => {
    if (store.openId && location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    store.openId = null;
    const card = grid.querySelector(`[data-id="${modal.dataset.lastId}"]`);
    if (card) card.focus();
  });

  const onScroll = () => {
    backTop.classList.toggle("is-visible", window.scrollY > 600);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  backTop.addEventListener("click", () => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  });

  /* 复制 / Toast */

  function copyText(text) {
    const fallback = () =>
      new Promise((resolve, reject) => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
        } catch (e) {
          reject(e);
        }
        ta.remove();
      });
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
  }

  let toastTimer;
  function showToast(msg) {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-visible"), 1800);
  }

  boot();
})();
