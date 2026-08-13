/* 渲染层：卡片、模态、筛选、Markdown 等纯函数
   不持有状态，状态由 app.js 传入并负责挂载 */

window.WikiRender = (function () {
  "use strict";

  const SITE = "https://openweb.wiki";
  const BRAND = "openweb.wiki";

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const uriOf = (id) => SITE + "/#/entries/" + encodeURIComponent(id);
  const hashOf = (id) => "#/entries/" + encodeURIComponent(id);

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  /* 模板占位符，如 {{author}}，由数据替换 */
  function applyTemplate(text, vars) {
    const v = vars || {};
    return String(text == null ? "" : text).replace(/\{\{(\w+)\}\}/g, function (_, k) {
      return v[k] != null ? v[k] : "";
    });
  }

  /* wikilink 双向引用解析 */
  function findEntry(entries, ref) {
    const r = ref.trim();
    return (
      entries.find(function (e) { return e.id.toLowerCase() === r.toLowerCase(); }) ||
      entries.find(function (e) { return e.title.toLowerCase() === r.toLowerCase(); }) ||
      null
    );
  }

  function linkify(text, entries, vars) {
    const pool = entries || [];
    return applyTemplate(esc(text), vars).replace(/\[\[([^\]]+)\]\]/g, function (_, ref) {
      const target = findEntry(pool, ref);
      if (!target) {
        return '<span class="wikilink" title="条目不存在">' + esc(ref) + "</span>";
      }
      const label =
        /^[A-Za-z0-9-]+$/.test(target.id) && ref.trim() === target.id
          ? target.id
          : target.title;
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

  /* 轻量 Markdown 行内渲染 */
  function mdInline(str) {
    return esc(str)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
        return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + "</a>";
      })
      .replace(/&lt;([a-z][a-z0-9+.-]*:\/\/[^&]+)&gt;/gi, function (_, u) {
        return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + "</a>";
      })
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function mdTable(rows) {
    const head = rows[0].split("|").map(function (c) { return c.trim(); }).filter(Boolean);
    const body = rows
      .slice(2)
      .map(function (r) {
        return r.split("|").map(function (c) { return c.trim(); }).filter(Boolean);
      })
      .filter(function (cells) { return cells.length; });
    if (!body.length) return "";
    const th = head.map(function (h) { return "<th>" + mdInline(h) + "</th>"; }).join("");
    const trs = body
      .map(function (cells) {
        return "<tr>" + cells.map(function (c) {
          return "<td>" + mdInline(c) + "</td>";
        }).join("") + "</tr>";
      })
      .join("");
    return (
      '<div class="md-table"><table><thead><tr>' + th +
      "</tr></thead><tbody>" + trs + "</tbody></table></div>"
    );
  }

  /* 轻量 Markdown 渲染，支持标题、列表、表格、引用、代码块 */
  function mdToHtml(md) {
    const lines = String(md == null ? "" : md).replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let inCode = false;
    let codeLang = "";
    let codeBuf = [];
    let inTable = false;
    let tableBuf = [];
    let listBuf = [];
    let quoteBuf = [];

    const flushList = function () {
      if (listBuf.length) {
        html += "<ul>" + listBuf.map(function (li) {
          return "<li>" + li + "</li>";
        }).join("") + "</ul>";
        listBuf = [];
      }
    };
    const flushTable = function () {
      if (inTable) {
        html += mdTable(tableBuf);
        tableBuf = [];
        inTable = false;
      }
    };
    const flushQuote = function () {
      if (quoteBuf.length) {
        html += "<blockquote>" + quoteBuf.join("<br>") + "</blockquote>";
        quoteBuf = [];
      }
    };
    const flushAll = function () {
      flushList();
      flushTable();
      flushQuote();
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith("```")) {
        if (inCode) {
          const langClass = codeLang ? ' class="lang-' + esc(codeLang) + '"' : "";
          html += "<pre><code" + langClass + ">" + esc(codeBuf.join("\n")) + "</code></pre>";
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
      if (inCode) {
        codeBuf.push(line);
        continue;
      }

      if (!trimmed) {
        flushAll();
        continue;
      }

      if (/^#{1,4} /.test(trimmed)) {
        flushAll();
        const level = trimmed.match(/^#+/)[0].length;
        const content = mdInline(trimmed.replace(/^#+ /, ""));
        html += "<h" + (level + 1) + ">" + content + "</h" + (level + 1) + ">";
      } else if (/^\|/.test(trimmed) && trimmed.endsWith("|")) {
        if (!inTable) {
          flushList();
          flushQuote();
          inTable = true;
        }
        tableBuf.push(trimmed);
      } else if (/^&gt; /.test(trimmed) || /^> /.test(trimmed)) {
        flushList();
        flushTable();
        quoteBuf.push(mdInline(trimmed.replace(/^&gt; /, "").replace(/^> /, "")));
      } else if (/^[-*] /.test(trimmed)) {
        flushTable();
        flushQuote();
        listBuf.push(mdInline(trimmed.replace(/^[-*] /, "")));
      } else if (/^\d+\. /.test(trimmed)) {
        flushTable();
        flushQuote();
        listBuf.push(mdInline(trimmed.replace(/^\d+\. /, "")));
      } else {
        flushAll();
        html += "<p>" + mdInline(trimmed) + "</p>";
      }
    }
    flushAll();
    if (inCode) {
      html += "<pre><code>" + esc(codeBuf.join("\n")) + "</code></pre>";
    }
    return html;
  }

  /* 分类筛选 chips */
  const CAT_ORDER = ["项目", "笔记", "灵感", "阅读", "折腾", "关于"];

  function filters(entries, activeCategory) {
    const rank = function (c) {
      const i = CAT_ORDER.indexOf(c);
      return i === -1 ? 999 : i;
    };
    const cats = ["全部"].concat(
      Array.from(new Set(entries.map(function (e) { return e.category; }))).sort(function (a, b) {
        return rank(a) - rank(b);
      })
    );
    return cats
      .map(function (c) {
        return (
          '<button class="chip' + (c === activeCategory ? " is-active" : "") + '" ' +
          'type="button" data-filter="' + esc(c) + '">' + esc(c) + "</button>"
        );
      })
      .join("");
  }

  /* 卡片 */
  function card(e, i, vars) {
    return safe(function () { return cardInner(e, i, vars); }, cardFallback(e, i));
  }

  function cardFallback(e, i) {
    const id = (e && e.id) || "?";
    return (
      '<article class="entry" style="--i:' + i + '" data-id="' + esc(id) + '">' +
      '<span class="entry__meta"><span class="entry__id">' + esc(id) + "</span></span>" +
      '<p class="entry__summary">该条目渲染失败</p></article>'
    );
  }

  function cardInner(e, i, vars) {
    const tags = (e.tags || [])
      .map(function (t) {
        return '<button class="entry__tag" type="button" data-tag="' + esc(t) + '">#' + esc(t) + "</button>";
      })
      .join("");

    /* source 是 GitHub 地址就链仓库，否则链官网 */
    const srcHref =
      e.source && e.source.indexOf("github.com/") === 0
        ? e.url
        : e.homepage || e.url;
    const src = e.source
      ? srcHref
        ? '<a class="entry__src" href="' + esc(srcHref) + '" target="_blank" rel="noopener noreferrer" ' +
          'title="' + esc(e.source) + '" aria-label="打开 ' + esc(e.source) + '">' + esc(e.source) + "</a>"
        : '<span class="entry__src" title="' + esc(e.source) + '">' + esc(e.source) + "</span>"
      : "";

    return (
      '<article class="entry" tabindex="0" role="button" style="--i:' + i + '" ' +
      'aria-label="打开条目 ' + esc(e.id) + '：' + esc(e.title) + '" data-id="' + esc(e.id) + '">' +
      '<span class="entry__meta">' +
      '<span class="entry__id">' + esc(e.id) + "</span>" +
      '<span class="entry__date">' + esc(e.date) + "</span>" +
      '<span class="entry__cat">' + esc(e.category) + "</span>" +
      (e.stars != null
        ? '<span class="entry__star" title="GitHub star 数">' +
          '<svg aria-hidden="true"><use href="#i-star"/></svg>' + e.stars + "</span>"
        : "") +
      "</span>" +
      '<h2 class="entry__title">' + esc(applyTemplate(e.title, vars)) + "</h2>" +
      '<p class="entry__summary">' + esc(applyTemplate(e.summary, vars)) + "</p>" +
      '<span class="entry__foot">' +
      (tags ? tags : "") +
      src +
      "</span>" +
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

  /* 模态 */
  function modal(e, bodyEl, entries, vars, readmeHtml) {
    try {
      modalInner(e, bodyEl, entries, vars, readmeHtml);
    } catch (err) {
      if (bodyEl) bodyEl.innerHTML = "<p>该条目数据异常</p>";
    }
  }

  function modalInner(e, bodyEl, entries, vars, readmeHtml) {
    const tags = (e.tags || [])
      .map(function (t) {
        return '<button class="modal__tag" type="button" data-tag="' + esc(t) + '">#' + esc(t) + "</button>";
      })
      .join("");

    const links =
      e.homepage || e.url
        ? '<div class="modal__links">' +
          [e.homepage && { href: e.homepage, icon: "#i-home" },
           e.url && { href: e.url, icon: "#i-external" }]
            .filter(Boolean)
            .map(function (l) {
              return (
                '<a class="modal__link" href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer">' +
                '<svg width="13" height="13" aria-hidden="true"><use href="' + l.icon + '"/></svg>' +
                "<span>" + esc(l.href.replace(/^https?:\/\//, "")) + "</span></a>"
              );
            })
            .join("") +
          "</div>"
        : "";

    bodyEl.innerHTML =
      '<div class="modal__meta">' +
      '<span class="modal__id">' + esc(e.id) + "</span>" +
      '<span class="modal__date">' + esc(e.date) + "</span>" +
      '<span class="modal__cat">' + esc(e.category) + "</span>" +
      "</div>" +
      '<h2 class="modal__title">' + esc(e.title) + "</h2>" +
      paragraphs(e.body, entries, vars) +
      (readmeHtml
        ? '<div class="modal__readme"><h3 class="modal__sub">仓库 README</h3>' + readmeHtml + "</div>"
        : "") +
      links +
      (tags ? '<div class="modal__tags">' + tags + "</div>" : "") +
      '<div class="modal__uri">' +
      '<span class="modal__uri-code">' + esc(uriOf(e.id)) + "</span>" +
      '<button class="entry__copy" type="button" data-copy="' + esc(uriOf(e.id)) + '" aria-label="复制条目地址">' +
      '<svg width="13" height="13" aria-hidden="true"><use href="#i-copy"/></svg>' +
      "</button></div>";
  }

  /* 模态搜索 */
  function searchResults(list, el) {
    safe(function () { searchInner(list, el); }, null);
  }

  function searchInner(list, el) {
    if (!list || !list.length) {
      el.innerHTML = '<div class="modal__search-empty">没有匹配的条目</div>';
    } else {
      el.innerHTML = list
        .map(function (h) {
          return (
            '<button class="modal__search-item" type="button" data-jump="' + esc(h.id) + '">' +
            '<span class="item-id">' + esc(h.id) + "</span>" +
            '<span class="item-title">' + esc(h.title) + "</span></button>"
          );
        })
        .join("");
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
