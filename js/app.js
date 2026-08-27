/* 入口层：状态管理、两阶段加载、主题、路由、事件
   阶段一 本地条目立即渲染，阶段二 GitHub 数据到达后合并渲染
   数据来自 WikiAPI，渲染交给 WikiRender */

(function () {
  "use strict";

  var STORAGE_KEY = "ow-theme";
  var rootEl = document.documentElement;
  var sysDark = window.matchMedia("(prefers-color-scheme: dark)");
  var supportsDialog = typeof HTMLDialogElement !== "undefined";

  /* DOM 引用一次缓存 */
  var headEl = document.querySelector(".head");
  var grid = document.getElementById("grid");
  var statusEl = document.getElementById("status");
  var filtersEl = document.getElementById("filters");
  var searchInput = document.getElementById("search");
  var modal = document.getElementById("modal");
  var modalBody = document.getElementById("modal-body");
  var modalClose = document.getElementById("modal-close");
  var modalSearch = document.getElementById("modal-search");
  var modalResults = document.getElementById("modal-search-results");
  var footUri = document.getElementById("foot-uri");
  var themeToggle = document.getElementById("theme-toggle");
  var backTop = document.getElementById("back-top");
  var heroTitle = document.getElementById("author-name");
  var heroSub = document.getElementById("author-sub");
  var footNote = document.getElementById("foot-note");

  var R = window.WikiRender;

  var store = {
    entries: [],
    author: null,
    readmeHtml: "",
    readmeCache: {},
    category: "全部",
    query: "",
    openId: null,
    phase: "loading",
    remoteFailed: false,
    remoteCached: false,
    rateLimited: false,
    /* 视图缓存：entries/query/category 变化时置脏，render 时重建 */
    _dirty: true,
    _visible: null
  };

  /* ── 主题 ── */

  function currentTheme() {
    var t = rootEl.dataset.theme;
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
    var saved = localStorage.getItem(STORAGE_KEY);
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

  /* ── 搜索文本预构建 ── */

  function buildSearchText(e) {
    var parts = [e.id, e.title, e.summary, e.category];
    if (e.tags) parts.push.apply(parts, e.tags);
    return parts.join(" ").toLowerCase();
  }

  function markDirty() { store._dirty = true; }

  /* ── 作者信息渲染 ── */

  function renderAuthor() {
    var a = store.author;
    var name = a && (a.name || a.login);
    heroTitle.textContent = name ? name + " 的知识库" : "知识库";
    heroSub.textContent = (a && a.bio) || "项目、笔记、折腾记录，每条知识都有自己的地址。";
    footNote.textContent = (name ? name + " · " : "") + "个人知识库，条目开放共享";
    document.title = "openweb.wiki" + (name ? " · " + name + " 的知识库" : "");
  }

  /* ── 列表渲染（带视图缓存） ── */

  function visibleEntries() {
    if (!store._dirty && store._visible) return store._visible;

    var q = store.query.trim().toLowerCase();
    var cat = store.category;
    var entries = store.entries;
    var result = [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (cat !== "全部" && e.category !== cat) continue;
      if (q && (e._searchText || buildSearchText(e)).indexOf(q) === -1) continue;
      result.push(e);
    }

    result.sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });

    store._visible = result;
    store._dirty = false;
    return result;
  }

  function render() {
    try {
      var list = visibleEntries();
      var authorName = store.author ? (store.author.name || store.author.login) : "";
      R.grid(list, grid, { author: authorName });

      var parts = [];
      if (list.length) parts.push(String(list.length).padStart(2, "0") + " 条条目");
      if (store.query) parts.push("关键词「" + store.query + "」");
      if (store.category !== "全部") parts.push(store.category);
      if (store.phase === "syncing") parts.push("正在同步 GitHub 数据…");
      if (store.rateLimited) {
        parts.push("GitHub API 配额已用尽，数据来自缓存");
      } else if (store.remoteFailed) {
        parts.push("GitHub 数据暂不可用，数据来自缓存");
      } else if (store.remoteCached) {
        parts.push("使用缓存数据（网络验证中…）");
      }
      if (store.phase === "error") parts.push("加载失败，请刷新重试");

      var dotClass = "";
      if (store.phase === "syncing") dotClass = " is-syncing";
      else if (store.remoteFailed || store.rateLimited || store.phase === "error") dotClass = " is-warn";

      statusEl.innerHTML =
        '<span class="status-dot' + dotClass + '"></span>' + parts.join(" · ");
      footUri.textContent = R.BRAND;
    } catch (e) {
      statusEl.textContent = "渲染异常，请刷新重试";
    }
  }

  /* ── 数据合并 ── */

  function mergeSiteRepo(local, site) {
    for (var i = 0; i < local.length; i++) {
      if (local[i].category === "关于") {
        local[i].source = site.source;
        local[i].url = site.url;
        local[i].homepage = site.homepage;
        return;
      }
    }
  }

  function mergeEntries(local, remote) {
    var seen = Object.create(null);
    for (var i = 0; i < local.length; i++) seen[local[i].id] = true;
    var merged = local.slice();
    for (var j = 0; j < remote.length; j++) {
      if (!seen[remote[j].id]) merged.push(remote[j]);
    }
    return merged;
  }

  function renderAll() {
    try {
      renderAuthor();
      filtersEl.innerHTML = R.filters(store.entries, store.category);
    } catch (e) {}
    render();
  }

  function renderSkeleton() {
    var html = "";
    for (var i = 0; i < 6; i++) html += '<div class="skeleton"></div>';
    grid.innerHTML = html;
  }

  /* ── 启动 ── */

  async function boot() {
    try { initTheme(); } catch (e) {}

    store.phase = "loading";
    renderSkeleton();

    /* 阶段一：本地条目，始终请求（no-cache），失败回退缓存 */
    var localRes = await WikiAPI.getEntries();
    var local = localRes.value;
    if (!local) {
      store.phase = "error";
      grid.innerHTML =
        '<div class="empty"><div class="empty__icon">!</div>本地数据加载失败<br>请检查网络后刷新</div>';
      render();
      return;
    }

    /* 预构建搜索索引 */
    for (var i = 0; i < local.length; i++) local[i]._searchText = buildSearchText(local[i]);
    store.entries = local;
    markDirty();
    store.phase = "local";
    renderAll();

    /* 阶段二：GitHub 数据，始终发请求（ETag 条件），缓存仅作兜底 */
    store.phase = "syncing";
    render();

    var remote = await WikiAPI.getRemote();
    store.phase = "ready";
    store.rateLimited = !!remote.rateLimited;
    store.remoteCached = !remote.fresh;

    if (remote.ok) {
      try {
        if (remote.author) store.author = remote.author;
        if (remote.site) mergeSiteRepo(local, remote.site);
        if (remote.readme) store.readmeHtml = R.mdToHtml(remote.readme);
        if (remote.projects.length) {
          /* 预构建远程条目的搜索索引 */
          for (var j = 0; j < remote.projects.length; j++) {
            remote.projects[j]._searchText = buildSearchText(remote.projects[j]);
          }
          store.entries = mergeEntries(local, remote.projects);
          markDirty();
        }
      } catch (e) {}
    } else {
      store.remoteFailed = true;
    }

    renderAll();
    routeFromHash();
  }

  /* ── 模态 ── */

  function openEntry(id) {
    var e = null;
    var entries = store.entries;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) { e = entries[i]; break; }
    }
    if (!e) return;

    R.modal(
      e, modalBody, entries,
      { author: store.author ? (store.author.name || store.author.login) : "" },
      e.category === "关于" ? store.readmeHtml : ""
    );
    store.openId = e.id;
    modal.dataset.lastId = e.id;
    modalSearch.value = "";
    modalResults.classList.remove("is-open");

    if (supportsDialog) { modal.showModal(); }
    else { modal.classList.add("is-fallback"); modal.removeAttribute("hidden"); }

    if (e.category === "项目") fillRepoReadme(e.id, modalBody);
    if (location.hash !== R.hashOf(e.id)) {
      history.pushState(null, "", R.hashOf(e.id));
    }
  }

  async function fillRepoReadme(repo, bodyEl) {
    if (!repo || bodyEl.querySelector(".modal__readme[data-repo]")) return;
    var box = document.createElement("div");
    box.className = "modal__readme";
    box.dataset.repo = repo;
    box.innerHTML =
      '<h3 class="modal__sub">仓库 README</h3>' +
      '<div class="modal__readme-body">加载中…</div>';
    bodyEl.appendChild(box);
    var body = box.querySelector(".modal__readme-body");

    var html = store.readmeCache[repo];
    if (!html) {
      var res = await WikiAPI.getRepoReadme(repo);
      if (res.value) {
        html = R.mdToHtml(res.value);
        store.readmeCache[repo] = html;
      }
    }
    if (store.openId !== repo || !body.isConnected) return;
    body.innerHTML = html || "<p>（该仓库无 README）</p>";
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

  /* ── Hash 路由 ── */

  function routeFromHash() {
    var m = location.hash.match(/^#\/?entries\/(.+)$/i);
    if (m) {
      var id = decodeURIComponent(m[1]);
      var entries = store.entries;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === id) { openEntry(id); return; }
      }
    }
  }

  window.addEventListener("popstate", function () {
    if (!location.hash) closeModal();
    else routeFromHash();
  });

  /* ── 模态内搜索 ── */

  var modalDebounce;
  function scheduleModalSearch() {
    clearTimeout(modalDebounce);
    modalDebounce = setTimeout(function () { renderModalResults(modalSearch.value); }, 100);
  }

  function renderModalResults(q) {
    var qq = q.trim().toLowerCase();
    if (!qq) { modalResults.classList.remove("is-open"); return; }

    var hits = [];
    var entries = store.entries;
    for (var i = 0; i < entries.length && hits.length < 8; i++) {
      var e = entries[i];
      if ((e._searchText || buildSearchText(e)).indexOf(qq) !== -1) hits.push(e);
    }
    R.searchResults(hits, modalResults);
  }

  modalSearch.addEventListener("input", scheduleModalSearch);
  modalSearch.addEventListener("focus", function () {
    if (modalSearch.value) renderModalResults(modalSearch.value);
  });
  modalSearch.addEventListener("blur", function () {
    setTimeout(function () { modalResults.classList.remove("is-open"); }, 150);
  });

  /* ── 全局事件委托 ── */

  document.addEventListener("click", function (ev) {
    var target = ev.target;

    var jump = target.closest("[data-jump]");
    if (jump) { ev.stopPropagation(); openEntry(jump.dataset.jump); return; }

    var copyBtn = target.closest("[data-copy]");
    if (copyBtn) {
      ev.stopPropagation();
      copyText(copyBtn.dataset.copy)
        .then(function () { showToast("已复制条目地址"); })
        .catch(function () { showToast("复制失败 · 可长按地址手动复制"); });
      return;
    }

    var tagBtn = target.closest("[data-tag]");
    if (tagBtn) {
      ev.stopPropagation();
      var tag = tagBtn.dataset.tag;
      searchInput.value = tag;
      store.query = tag;
      store.category = "全部";
      markDirty();
      filtersEl.querySelectorAll(".chip").forEach(function (c) {
        c.classList.toggle("is-active", c.dataset.filter === "全部");
      });
      render();
      return;
    }

    var wiki = target.closest("[data-wiki]");
    if (wiki) { ev.preventDefault(); openEntry(wiki.dataset.wiki); return; }

    if (target.closest("a")) return;
    var card = target.closest(".entry");
    if (card) openEntry(card.dataset.id);
  });

  grid.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" || ev.key === " ") {
      var card = ev.target.closest(".entry");
      if (card) { ev.preventDefault(); openEntry(card.dataset.id); }
    }
  });

  filtersEl.addEventListener("click", function (ev) {
    var chip = ev.target.closest(".chip");
    if (!chip) return;
    store.category = chip.dataset.filter;
    markDirty();
    filtersEl.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("is-active", c === chip);
    });
    render();
  });

  var searchDebounce;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      store.query = searchInput.value;
      markDirty();
      render();
    }, 120);
  });

  /* ── 模态事件 ── */

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", function (ev) {
    if (ev.target === modal) closeModal();
  });
  modal.addEventListener("close", function () {
    if (store.openId && location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    store.openId = null;
    var lastId = modal.dataset.lastId;
    if (lastId) {
      var cards = grid.querySelectorAll(".entry");
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.id === lastId) { cards[i].focus(); break; }
      }
    }
  });

  /* ── 滚动 ── */

  var onScroll = function () {
    var y = window.scrollY;
    backTop.classList.toggle("is-visible", y > 600);
    if (headEl) headEl.classList.toggle("is-scrolled", y > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  backTop.addEventListener("click", function () {
    var smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  });

  /* ── 复制与 Toast ── */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (e) { reject(e); }
      ta.remove();
    });
  }

  var toastTimer, toastEl;
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

  /* ── 全局兜底 ── */

  window.addEventListener("error", function (e) {
    var g = document.getElementById("grid");
    if (g && !g.querySelector(".entry") && !g.querySelector(".skeleton")) {
      g.innerHTML =
        '<div class="empty"><div class="empty__icon">!</div>页面发生错误：' +
        R.esc(e.message || "未知错误") + "<br>请刷新重试</div>";
    }
  });

  window.addEventListener("unhandledrejection", function (e) {
    console.error("未处理的异步错误", e && e.reason);
  });

  /* ── 键盘导航 ── */

  var usingKeyboard = false;
  window.addEventListener("keydown", function (e) {
    if (e.key === "Tab") usingKeyboard = true;
  });
  window.addEventListener("pointerdown", function () { usingKeyboard = false; });
  document.addEventListener("focusin", function (e) {
    if (usingKeyboard && e.target && e.target.classList) e.target.classList.add("kb-focus");
  });
  document.addEventListener("focusout", function (e) {
    if (e.target && e.target.classList) e.target.classList.remove("kb-focus");
  });

  boot();
})();
