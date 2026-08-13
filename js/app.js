/* 入口层：状态管理、两阶段加载、主题、路由、事件
   阶段一 本地条目立即渲染，阶段二 GitHub 数据到达后合并渲染
   数据来自 WikiAPI，渲染交给 WikiRender */

(function () {
  "use strict";

  const STORAGE_KEY = "ow-theme";
  const rootEl = document.documentElement;
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)");
  const supportsDialog = typeof HTMLDialogElement !== "undefined";

  const headEl = document.querySelector(".head");
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

  const store = {
    entries: [],
    author: null,
    readmeHtml: "",
    readmeCache: {},
    category: "全部",
    query: "",
    openId: null,
    phase: "loading",
    remoteFailed: false,
    rateLimited: false
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

  themeToggle.addEventListener("click", function () {
    rootEl.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, rootEl.dataset.theme); } catch (e) {}
    syncThemeIcon();
  });

  sysDark.addEventListener("change", function () {
    if (!localStorage.getItem(STORAGE_KEY)) syncThemeIcon();
  });

  /* 作者信息渲染 */
  function renderAuthor() {
    const name = (store.author && store.author.name) || "Yutong Fan";
    heroTitle.innerHTML =
      '<span class="hero__accent">' + R.esc(name) + "</span> 的知识库";
    heroSub.textContent =
      (store.author && store.author.bio) ||
      "项目、笔记、折腾记录 —— 每条知识都有自己的地址。";
    footNote.textContent = name + " · 个人知识库，条目开放共享";
    document.title = "openweb.wiki · " + name + " 的知识库";
  }

  /* 列表渲染 */
  function visibleEntries() {
    const q = store.query.trim().toLowerCase();
    return store.entries
      .filter(function (e) {
        return store.category === "全部" || e.category === store.category;
      })
      .filter(function (e) {
        if (!q) return true;
        return [e.id, e.title, e.summary, e.body, e.category]
          .concat(e.tags || [])
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort(function (a, b) {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        return 0;
      });
  }

  function render() {
    try {
      const list = visibleEntries();
      R.grid(list, grid, { author: store.author ? store.author.name : "" });
      const parts = [];
      if (list.length) {
        parts.push(String(list.length).padStart(2, "0") + " 条条目");
      }
      if (store.query) parts.push("关键词「" + store.query + "」");
      if (store.category !== "全部") parts.push(store.category);
      if (store.phase === "syncing") parts.push("正在同步 GitHub 数据…");
      if (store.rateLimited) {
        parts.push("GitHub API 配额已用尽，显示缓存数据");
      } else if (store.remoteFailed) {
        parts.push("GitHub 数据暂不可用，显示缓存数据");
      }
      if (store.phase === "error") parts.push("加载失败，请刷新重试");

      let dotClass = "";
      if (store.phase === "syncing") dotClass = " is-syncing";
      else if (store.remoteFailed || store.rateLimited || store.phase === "error") {
        dotClass = " is-warn";
      }
      status.innerHTML =
        '<span class="status-dot' + dotClass + '"></span>' + parts.join(" · ");
      footUri.textContent = R.BRAND;
    } catch (e) {
      status.textContent = "渲染异常，请刷新重试";
    }
  }

  /* 入场动画：视口内卡片立即播放，视口外卡片滚动进入时播放。
     卡片本体始终可见，动画是渐进增强，另设兜底定时器防极端环境下动画卡住 */
  const knownIds = new Set();
  let revealObserver = null;
  let revealFallbackTimer = null;

  function revealNewCards() {
    if (!revealObserver && "IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("reveal");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.06, rootMargin: "0px 0px -30px 0px" }
      );
    }
    const vh = window.innerHeight || document.documentElement.clientHeight;
    grid.querySelectorAll(".entry").forEach(function (card) {
      const id = card.dataset.id;
      if (knownIds.has(id)) return;
      knownIds.add(id);
      const rect = card.getBoundingClientRect();
      if (rect.top < vh && rect.bottom > 0) {
        card.classList.add("reveal");
      } else if (revealObserver) {
        revealObserver.observe(card);
      }
    });
    clearTimeout(revealFallbackTimer);
    revealFallbackTimer = setTimeout(function () {
      grid.querySelectorAll(".entry.reveal").forEach(function (card) {
        card.classList.remove("reveal");
      });
    }, 3000);
  }

  /* 两阶段加载 */
  function mergeSiteRepo(local, site) {
    const about = local.find(function (e) { return e.category === "关于"; });
    if (about && site) {
      about.source = site.source;
      about.url = site.url;
      about.homepage = site.homepage;
    }
  }

  function mergeEntries(local, remote) {
    const seen = new Set(local.map(function (e) { return e.id; }));
    return local.concat(remote.filter(function (p) { return !seen.has(p.id); }));
  }

  function renderAll() {
    try {
      renderAuthor();
      filtersEl.innerHTML = R.filters(store.entries, store.category);
    } catch (e) {
      /* 单点失败不阻塞后续 */
    }
    render();
    revealNewCards();
  }

  function renderSkeleton() {
    let html = "";
    for (let i = 0; i < 6; i++) html += '<div class="skeleton"></div>';
    grid.innerHTML = html;
  }

  async function boot() {
    try { initTheme(); } catch (e) {}

    store.phase = "loading";
    renderSkeleton();

    let local = null;
    try {
      local = await WikiAPI.getEntries();
    } catch (e) {
      local = null;
    }
    if (!local) {
      store.phase = "error";
      grid.innerHTML =
        '<div class="empty"><div class="empty__icon">!</div>本地数据加载失败<br>请检查网络后刷新</div>';
      render();
      return;
    }
    store.entries = local;
    store.phase = "local";
    renderAll();

    /* 阶段二：GitHub 数据后补，内部已做缓存兜底，永不抛错 */
    store.phase = "syncing";
    render();
    const forceSync = /[?&]force=1/.test(location.search);
    const remote = await WikiAPI.getRemote(forceSync);
    store.phase = "ready";
    store.rateLimited = !!remote.rateLimited;
    if (remote.ok) {
      try {
        if (remote.author) store.author = remote.author;
        if (remote.site) mergeSiteRepo(local, remote.site);
        if (remote.readme) store.readmeHtml = R.mdToHtml(remote.readme);
        store.entries = mergeEntries(local, remote.projects);
      } catch (e) {
        /* 合并失败不阻塞 */
      }
    } else {
      store.remoteFailed = true;
    }
    renderAll();
    routeFromHash();
  }

  /* 模态 */
  function openEntry(id) {
    const e = store.entries.find(function (x) { return x.id === id; });
    if (!e) return;
    R.modal(
      e,
      modalBody,
      store.entries,
      { author: store.author ? store.author.name : "" },
      e.category === "关于" ? store.readmeHtml : ""
    );
    store.openId = e.id;
    modal.dataset.lastId = e.id;
    modalSearch.value = "";
    modalResults.classList.remove("is-open");
    if (supportsDialog) {
      modal.showModal();
    } else {
      modal.classList.add("is-fallback");
      modal.removeAttribute("hidden");
    }
    if (e.category === "项目") fillRepoReadme(e.id, modalBody);
    if (location.hash !== R.hashOf(e.id)) {
      history.pushState(null, "", R.hashOf(e.id));
    }
  }

  /* 项目条目按需拉取仓库 README，异步填入模态，带守卫防止串台 */
  async function fillRepoReadme(repo, bodyEl) {
    if (!repo || bodyEl.querySelector(".modal__readme[data-repo]")) return;
    const box = document.createElement("div");
    box.className = "modal__readme";
    box.dataset.repo = repo;
    box.innerHTML =
      '<h3 class="modal__sub">仓库 README</h3>' +
      '<div class="modal__readme-body">加载中…</div>';
    bodyEl.appendChild(box);
    const body = box.querySelector(".modal__readme-body");
    let html = store.readmeCache[repo];
    if (!html) {
      const md = await WikiAPI.getRepoReadme(repo);
      if (md) {
        html = R.mdToHtml(md);
        store.readmeCache[repo] = html;
      }
    }
    if (store.openId !== repo || !body.isConnected) return;
    body.innerHTML = html ? html : "<p>（该仓库无 README）</p>";
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
      if (store.entries.some(function (e) { return e.id === id; })) openEntry(id);
    }
  }

  window.addEventListener("popstate", function () {
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
      .filter(function (e) {
        return [e.id, e.title, e.summary]
          .concat(e.tags || [])
          .join(" ")
          .toLowerCase()
          .includes(qq);
      })
      .slice(0, 8);
    R.searchResults(hits, modalResults);
  }

  modalSearch.addEventListener("input", function () {
    renderModalResults(modalSearch.value);
  });
  modalSearch.addEventListener("focus", function () {
    if (modalSearch.value) renderModalResults(modalSearch.value);
  });
  modalSearch.addEventListener("blur", function () {
    setTimeout(function () { modalResults.classList.remove("is-open"); }, 150);
  });

  /* 全局事件委托 */
  document.addEventListener("click", function (ev) {
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
        .then(function () { showToast("已复制条目地址"); })
        .catch(function () { showToast("复制失败 · 可长按地址手动复制"); });
      return;
    }
    const tagBtn = ev.target.closest("[data-tag]");
    if (tagBtn) {
      ev.stopPropagation();
      searchInput.value = tagBtn.dataset.tag;
      store.query = tagBtn.dataset.tag;
      store.category = "全部";
      filtersEl.querySelectorAll(".chip").forEach(function (c) {
        c.classList.toggle("is-active", c.dataset.filter === "全部");
      });
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

  grid.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" || ev.key === " ") {
      const card = ev.target.closest(".entry");
      if (card) {
        ev.preventDefault();
        openEntry(card.dataset.id);
      }
    }
  });

  filtersEl.addEventListener("click", function (ev) {
    const chip = ev.target.closest(".chip");
    if (!chip) return;
    store.category = chip.dataset.filter;
    filtersEl.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("is-active", c === chip);
    });
    render();
  });

  let debounce;
  searchInput.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      store.query = searchInput.value;
      render();
    }, 120);
  });

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", function (ev) {
    if (ev.target === modal) closeModal();
  });
  modal.addEventListener("close", function () {
    if (store.openId && location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    store.openId = null;
    const lastId = modal.dataset.lastId;
    if (lastId) {
      const card = grid.querySelector('[data-id="' + CSS.escape(lastId) + '"]');
      if (card) card.focus();
    }
  });

  const onScroll = function () {
    const y = window.scrollY;
    backTop.classList.toggle("is-visible", y > 600);
    if (headEl) headEl.classList.toggle("is-scrolled", y > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  backTop.addEventListener("click", function () {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  });

  /* 复制与 Toast */
  function copyText(text) {
    const fallback = function () {
      return new Promise(function (resolve, reject) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          if (document.execCommand("copy")) resolve();
          else reject(new Error("copy failed"));
        } catch (e) {
          reject(e);
        }
        ta.remove();
      });
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
  }

  let toastTimer;
  let toastEl = null;
  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-visible"); }, 1800);
  }

  /* 全局兜底：未捕获异常不白屏 */
  window.addEventListener("error", function (e) {
    const g = document.getElementById("grid");
    if (g && !g.querySelector(".entry") && !g.querySelector(".skeleton")) {
      g.innerHTML =
        '<div class="empty"><div class="empty__icon">!</div>页面发生错误：' +
        R.esc(e.message || "未知错误") +
        "<br>请刷新重试</div>";
    }
  });
  window.addEventListener("unhandledrejection", function (e) {
    console.error("未处理的异步错误", e && e.reason);
  });

  boot();
})();
