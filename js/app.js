/* 入口层：状态管理 / 主题 / 路由 / 事件
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
  let entries = [];
  let author = { name: "Yutong Fan" };
  let activeCategory = "全部";
  let query = "";
  let openId = null;

  /* ---------- 主题 ---------- */

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

  themeToggle.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    rootEl.dataset.theme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    syncThemeIcon();
  });

  sysDark.addEventListener("change", () => {
    if (!localStorage.getItem(STORAGE_KEY)) syncThemeIcon();
  });

  /* ---------- 数据 ---------- */

  function boot() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") rootEl.dataset.theme = saved;
    syncThemeIcon();

    Promise.all([
      WikiAPI.getAuthor(),
      WikiAPI.getEntries(),
      WikiAPI.getProjects()
    ])
      .then(([a, local, gh]) => {
        author = a;
        entries = local.concat(gh);
        renderAll();
        routeFromHash();
      })
      .catch(() => {
        grid.innerHTML =
          `<div class="empty">条目加载失败<br>请检查网络后刷新</div>`;
      });
  }

  function renderAll() {
    /* 作者信息（API 驱动，零硬编码） */
    if (heroTitle) {
      heroTitle.textContent = `${author.name} 的知识库`;
      heroSub.textContent = author.bio
        ? author.bio
        : "项目、笔记、折腾记录 —— 每条知识都有自己的地址。";
    }
    if (footNote) {
      footNote.textContent = `${author.name} · 个人知识库，条目开放共享`;
    }
    document.title = `openweb.wiki · ${author.name} 的知识库`;

    filtersEl.innerHTML = R.filters(entries, activeCategory);
    render();
  }

  /* ---------- 列表渲染 ---------- */

  function visibleEntries() {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => activeCategory === "全部" || e.category === activeCategory)
      .filter((e) => {
        if (!q) return true;
        return [e.id, e.title, e.summary, e.body, e.category, ...(e.tags || [])]
          .join(" ").toLowerCase().includes(q);
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function render() {
    const list = visibleEntries();
    R.grid(list, grid, { author: author.name });
    status.textContent = list.length
      ? `${String(list.length).padStart(2, "0")} 条条目` +
        (query ? ` · 关键词「${query}」` : "") +
        (activeCategory !== "全部" ? ` · ${activeCategory}` : "")
      : "";
    footUri.textContent = R.SITE;
  }

  /* ---------- 模态 ---------- */

  function openEntry(id) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    R.modal(e, modalBody, entries, { author: author.name });
    openId = e.id;
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
    if (openId && location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    openId = null;
  }

  /* ---------- hash 路由 ---------- */

  function routeFromHash() {
    const m = location.hash.match(/^#\/?entries\/(.+)$/i);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (entries.some((e) => e.id === id)) openEntry(id);
    }
  }

  window.addEventListener("popstate", () => {
    if (!location.hash) closeModal();
    else routeFromHash();
  });

  /* ---------- 模态搜索 ---------- */

  function renderModalResults(q) {
    const qq = q.trim().toLowerCase();
    if (!qq) {
      modalResults.classList.remove("is-open");
      return;
    }
    const hits = entries
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

  /* ---------- 事件 ---------- */

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
      query = tagBtn.dataset.tag;
      activeCategory = "全部";
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
    activeCategory = chip.dataset.filter;
    filtersEl.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("is-active", c === chip)
    );
    render();
  });

  let debounce;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      query = searchInput.value;
      render();
    }, 120);
  });

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) closeModal();
  });
  modal.addEventListener("close", () => {
    if (openId && location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    openId = null;
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

  /* ---------- 复制 / Toast ---------- */

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
