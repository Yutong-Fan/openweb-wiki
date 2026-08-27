/* 渲染层：卡片、模态、筛选、Markdown 等纯函数
   不持有状态，状态由 app.js 传入并负责挂载 */

window.WikiRender = (function () {
  "use strict";

  var SITE = "https://openweb.wiki";
  var BRAND = "openweb.wiki";

  /* ── 基础工具 ── */

  var escRe = /[&<>"']/g;
  var escMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function esc(s) {
    return String(s == null ? "" : s).replace(escRe, function (c) { return escMap[c]; });
  }

  function uriOf(id) { return SITE + "/#/entries/" + encodeURIComponent(id); }
  function hashOf(id) { return "#/entries/" + encodeURIComponent(id); }

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  /* 模板占位符 {{author}} 等 */
  function applyTemplate(text, vars) {
    var v = vars || {};
    return String(text == null ? "" : text).replace(/\{\{(\w+)\}\}/g, function (_, k) {
      return v[k] != null ? v[k] : "";
    });
  }

  /* ── wikilink 引用解析 ── */

  /* 预建查找索引：id/title → entry，O(1) 查找 */
  function buildEntryIndex(entries) {
    var byId = Object.create(null);
    var byTitle = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.id) byId[e.id.toLowerCase()] = e;
      if (e.title) byTitle[e.title.toLowerCase()] = e;
    }
    return { byId: byId, byTitle: byTitle };
  }

  function findEntry(index, ref) {
    var r = ref.trim().toLowerCase();
    return index.byId[r] || index.byTitle[r] || null;
  }

  function linkify(text, entries, vars) {
    if (!entries || !entries.length) return applyTemplate(esc(text), vars);
    var index = buildEntryIndex(entries);
    return applyTemplate(esc(text), vars).replace(/\[\[([^\]]+)\]\]/g, function (_, ref) {
      var target = findEntry(index, ref);
      if (!target) {
        return '<span class="wikilink" title="条目不存在">' + esc(ref) + "</span>";
      }
      var isIdRef = /^[A-Za-z0-9-]+$/.test(target.id) && ref.trim() === target.id;
      var label = isIdRef ? target.id : target.title;
      return (
        '<a class="wikilink" href="' + hashOf(target.id) +
        '" data-wiki="' + esc(target.id) + '">' + esc(label) + "</a>"
      );
    });
  }

  function paragraphs(text, entries, vars) {
    return text
      .split(/\n{2,}/)
      .map(function (p) { return p.trim(); })
      .filter(Boolean)
      .map(function (p) {
        return "<p>" + linkify(p.replace(/\n/g, "<br>"), entries, vars) + "</p>";
      })
      .join("");
  }

  /* ── 轻量 Markdown 渲染 ── */

  /* 预编译正则，避免每次调用重新编译 */
  var RE_CODE_FENCE = /^```/;
  var RE_HEADING = /^#{1,4} /;
  var RE_TABLE_ROW = /^\|/;
  var RE_QUOTE = /^> /;
  var RE_UL = /^[-*] /;
  var RE_OL = /^\d+\. /;

  /* 行内 Markdown：用单个 replace 链减少中间字符串分配 */
  var RE_INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*]+)\*|&lt;([a-z][a-z0-9+.-]*:\/\/[^&]+)&gt;/gi;

  function mdInline(str) {
    return esc(str).replace(RE_INLINE, function (m, code, bold, del, linkText, linkUrl, em, autoUrl) {
      if (code) return "<code>" + code + "</code>";
      if (bold) return "<strong>" + bold + "</strong>";
      if (del) return "<del>" + del + "</del>";
      if (linkText) return '<a href="' + linkUrl + '" target="_blank" rel="noopener noreferrer">' + linkText + "</a>";
      if (em) return "<em>" + em + "</em>";
      if (autoUrl) return '<a href="' + autoUrl + '" target="_blank" rel="noopener noreferrer">' + autoUrl + "</a>";
      return m;
    });
  }

  function mdTable(rows) {
    var head = rows[0].split("|").map(function (c) { return c.trim(); }).filter(Boolean);
    var body = rows
      .slice(2)
      .map(function (r) { return r.split("|").map(function (c) { return c.trim(); }).filter(Boolean); })
      .filter(function (cells) { return cells.length; });
    if (!body.length) return "";
    var th = head.map(function (h) { return "<th>" + mdInline(h) + "</th>"; }).join("");
    var trs = body
      .map(function (cells) {
        return "<tr>" + cells.map(function (c) { return "<td>" + mdInline(c) + "</td>"; }).join("") + "</tr>";
      })
      .join("");
    return (
      '<div class="md-table"><table><thead><tr>' + th +
      "</tr></thead><tbody>" + trs + "</tbody></table></div>"
    );
  }

  function mdToHtml(md) {
    var lines = String(md == null ? "" : md).replace(/\r\n/g, "\n").split("\n");
    var parts = [];
    var inCode = false, codeLang = "", codeBuf = [];
    var inTable = false, tableBuf = [];
    var listBuf = [], quoteBuf = [];

    function flushList() {
      if (listBuf.length) {
        parts.push("<ul>" + listBuf.map(function (li) { return "<li>" + li + "</li>"; }).join("") + "</ul>");
        listBuf = [];
      }
    }
    function flushTable() {
      if (inTable) {
        parts.push(mdTable(tableBuf));
        tableBuf = [];
        inTable = false;
      }
    }
    function flushQuote() {
      if (quoteBuf.length) {
        parts.push("<blockquote>" + quoteBuf.join("<br>") + "</blockquote>");
        quoteBuf = [];
      }
    }
    function flushAll() { flushList(); flushTable(); flushQuote(); }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (RE_CODE_FENCE.test(trimmed)) {
        if (inCode) {
          var cls = codeLang ? ' class="lang-' + esc(codeLang) + '"' : "";
          parts.push("<pre><code" + cls + ">" + esc(codeBuf.join("\n")) + "</code></pre>");
          codeBuf = [];
          codeLang = "";
          inCode = false;
        } else {
          flushAll();
          codeLang = trimmed.slice(3).trim();
          inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      if (!trimmed) { flushAll(); continue; }

      if (RE_HEADING.test(trimmed)) {
        flushAll();
        var level = trimmed.match(/^#+/)[0].length;
        parts.push("<h" + (level + 1) + ">" + mdInline(trimmed.replace(/^#+ /, "")) + "</h" + (level + 1) + ">");
      } else if (RE_TABLE_ROW.test(trimmed) && trimmed.charAt(trimmed.length - 1) === "|") {
        if (!inTable) { flushList(); flushQuote(); inTable = true; }
        tableBuf.push(trimmed);
      } else if (RE_QUOTE.test(trimmed)) {
        flushList(); flushTable();
        quoteBuf.push(mdInline(trimmed.slice(2)));
      } else if (RE_UL.test(trimmed)) {
        flushTable(); flushQuote();
        listBuf.push(mdInline(trimmed.slice(2)));
      } else if (RE_OL.test(trimmed)) {
        flushTable(); flushQuote();
        listBuf.push(mdInline(trimmed.replace(/^\d+\. /, "")));
      } else {
        flushAll();
        parts.push("<p>" + mdInline(trimmed) + "</p>");
      }
    }
    flushAll();
    if (inCode && codeBuf.length) {
      parts.push("<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>");
    }
    return parts.join("");
  }

  /* ── 分类筛选 ── */

  var CAT_ORDER = ["项目", "笔记", "灵感", "阅读", "折腾", "关于"];

  function filters(entries, activeCategory) {
    var rank = function (c) { var i = CAT_ORDER.indexOf(c); return i === -1 ? 999 : i; };
    var seen = Object.create(null);
    var cats = ["全部"];
    for (var i = 0; i < entries.length; i++) {
      var c = entries[i].category;
      if (c && !seen[c]) { seen[c] = true; cats.push(c); }
    }
    cats.sort(function (a, b) { return rank(a) - rank(b); });
    return cats
      .map(function (c) {
        return (
          '<button class="chip' + (c === activeCategory ? " is-active" : "") + '" ' +
          'type="button" data-filter="' + esc(c) + '">' + esc(c) + "</button>"
        );
      })
      .join("");
  }

  /* ── 卡片 ── */

  function card(e, i, vars) {
    return safe(function () { return cardInner(e, i, vars); }, cardFallback(e, i));
  }

  function cardFallback(e, i) {
    var id = (e && e.id) || "?";
    return (
      '<article class="entry" style="--i:' + i + '" data-id="' + esc(id) + '">' +
      '<span class="entry__meta"><span class="entry__id">' + esc(id) + "</span></span>" +
      '<p class="entry__summary">该条目渲染失败</p></article>'
    );
  }

  function cardInner(e, i, vars) {
    var tags = "";
    if (e.tags && e.tags.length) {
      tags = e.tags.map(function (t) {
        return '<button class="entry__tag" type="button" data-tag="' + esc(t) + '">#' + esc(t) + "</button>";
      }).join("");
    }

    var isGithub = e.source && e.source.indexOf("github.com/") === 0;
    var srcHref = isGithub ? e.url : (e.homepage || e.url);
    var src = "";
    if (e.source) {
      src = srcHref
        ? '<a class="entry__src" href="' + esc(srcHref) + '" target="_blank" rel="noopener noreferrer" ' +
          'title="' + esc(e.source) + '" aria-label="打开 ' + esc(e.source) + '">' + esc(e.source) + "</a>"
        : '<span class="entry__src" title="' + esc(e.source) + '">' + esc(e.source) + "</span>";
    }

    var star = "";
    if (e.stars != null) {
      star = '<span class="entry__star" title="GitHub star 数">' +
        '<svg aria-hidden="true"><use href="#i-star"/></svg>' + e.stars + "</span>";
    }

    return (
      '<article class="entry" tabindex="0" role="button" style="--i:' + i + '" ' +
      'aria-label="打开条目 ' + esc(e.id) + "：" + esc(e.title) + '" data-id="' + esc(e.id) + '">' +
      '<span class="entry__meta">' +
      '<span class="entry__id">' + esc(e.id) + "</span>" +
      '<span class="entry__date">' + esc(e.date) + "</span>" +
      '<span class="entry__cat">' + esc(e.category) + "</span>" +
      star +
      "</span>" +
      '<h2 class="entry__title">' + esc(applyTemplate(e.title, vars)) + "</h2>" +
      '<p class="entry__summary">' + esc(applyTemplate(e.summary, vars)) + "</p>" +
      '<span class="entry__foot">' + tags + src + "</span>" +
      "</article>"
    );
  }

  function grid(list, el, vars) {
    if (!list.length) {
      el.innerHTML =
        '<div class="empty"><div class="empty__icon">◌</div>没有匹配的条目<br>换个关键词试试</div>';
      return;
    }
    el.innerHTML = list.map(function (e, i) { return card(e, i, vars); }).join("");
  }

  /* ── 模态 ── */

  function modal(e, bodyEl, entries, vars, readmeHtml) {
    try {
      modalInner(e, bodyEl, entries, vars, readmeHtml);
    } catch (err) {
      if (bodyEl) bodyEl.innerHTML = "<p>该条目数据异常</p>";
    }
  }

  function modalInner(e, bodyEl, entries, vars, readmeHtml) {
    var tags = "";
    if (e.tags && e.tags.length) {
      tags = '<div class="modal__tags">' + e.tags.map(function (t) {
        return '<button class="modal__tag" type="button" data-tag="' + esc(t) + '">#' + esc(t) + "</button>";
      }).join("") + "</div>";
    }

    var links = "";
    if (e.homepage || e.url) {
      var items = [];
      if (e.homepage) items.push({ href: e.homepage, icon: "#i-home" });
      if (e.url) items.push({ href: e.url, icon: "#i-external" });
      links = '<div class="modal__links">' + items.map(function (l) {
        return (
          '<a class="modal__link" href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer">' +
          '<svg width="13" height="13" aria-hidden="true"><use href="' + l.icon + '"/></svg>' +
          "<span>" + esc(l.href.replace(/^https?:\/\//, "")) + "</span></a>"
        );
      }).join("") + "</div>";
    }

    var readme = readmeHtml
      ? '<div class="modal__readme"><h3 class="modal__sub">仓库 README</h3>' + readmeHtml + "</div>"
      : "";

    var uri = uriOf(e.id);
    bodyEl.innerHTML =
      '<div class="modal__meta">' +
      '<span class="modal__id">' + esc(e.id) + "</span>" +
      '<span class="modal__date">' + esc(e.date) + "</span>" +
      '<span class="modal__cat">' + esc(e.category) + "</span>" +
      "</div>" +
      '<h2 class="modal__title">' + esc(e.title) + "</h2>" +
      paragraphs(e.body, entries, vars) +
      readme + links + tags +
      '<div class="modal__uri">' +
      '<span class="modal__uri-code">' + esc(uri) + "</span>" +
      '<button class="entry__copy" type="button" data-copy="' + esc(uri) + '" aria-label="复制条目地址">' +
      '<svg width="13" height="13" aria-hidden="true"><use href="#i-copy"/></svg>' +
      "</button></div>";
  }

  /* ── 模态搜索 ── */

  function searchResults(list, el) {
    if (!list || !list.length) {
      el.innerHTML = '<div class="modal__search-empty">没有匹配的条目</div>';
    } else {
      el.innerHTML = list.map(function (h) {
        return (
          '<button class="modal__search-item" type="button" data-jump="' + esc(h.id) + '">' +
          '<span class="item-id">' + esc(h.id) + "</span>" +
          '<span class="item-title">' + esc(h.title) + "</span></button>"
        );
      }).join("");
    }
    el.classList.add("is-open");
  }

  return {
    esc: esc,
    uriOf: uriOf,
    hashOf: hashOf,
    SITE: SITE,
    BRAND: BRAND,
    applyTemplate: applyTemplate,
    filters: filters,
    card: card,
    grid: grid,
    modal: modal,
    searchResults: searchResults,
    linkify: linkify,
    mdToHtml: mdToHtml
  };
})();
