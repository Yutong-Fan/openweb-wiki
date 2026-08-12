/* 渲染层：卡片 / 模态 / 筛选 / 作者信息填充
   纯渲染函数，不持有状态；状态由 app.js 传入 */

window.WikiRender = (function () {
  "use strict";

  const SITE = "https://openweb.wiki";
  const BRAND = "openweb.wiki";

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const uriOf = (id) => `${SITE}/#/entries/${encodeURIComponent(id)}`;
  const hashOf = (id) => `#/entries/${encodeURIComponent(id)}`;

  /* 模板占位符：{{author}} 等由 API 数据替换 */
  function applyTemplate(text, vars) {
    const v = vars || {};
    return text.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      v[k] != null ? v[k] : ""
    );
  }

  /* 作者信息 */

  function author(el, author) {
    const name = author.name || "Yutong Fan";
    el.querySelectorAll("[data-author-name]").forEach((n) => {
      n.textContent = name;
    });
    if (el.dataset.authorBio) el.textContent = author.bio || "";
    document.title = `${SITE} · ${name} 的知识库`;
  }

  /* wikilink 解析 */

  function findEntry(entries, ref) {
    const r = ref.trim();
    return (
      entries.find((e) => e.id.toLowerCase() === r.toLowerCase()) ||
      entries.find((e) => e.title.toLowerCase() === r.toLowerCase()) ||
      null
    );
  }

  function linkify(text, entries, vars) {
    return applyTemplate(esc(text), vars).replace(
      /\[\[([^\]]+)\]\]/g,
      (_, ref) => {
        const target = findEntry(entries, ref);
        if (!target) {
          return `<span class="wikilink" title="条目不存在">${esc(ref)}</span>`;
        }
        const label =
          /^[A-Za-z0-9-]+$/.test(target.id) && ref.trim() === target.id
            ? target.id
            : target.title;
        return `<a class="wikilink" href="${hashOf(target.id)}" data-wiki="${esc(target.id)}">${esc(label)}</a>`;
      }
    );
  }

  function paragraphs(text, entries, vars) {
    return text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${linkify(p.replace(/\n/g, "<br>"), entries, vars)}</p>`)
      .join("");
  }


  /* 轻量 Markdown 渲染（README 融合用） */

  function mdInline(str) {
    return esc(str)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_, t, u) =>
          `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
      .replace(/&lt;([a-z][a-z0-9+.-]*:\/\/[^&]+)&gt;/gi,
        (_, u) =>
          `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function mdTable(rows) {
    const head = rows[0].split("|").map((c) => c.trim()).filter(Boolean);
    const body = rows.slice(2)
      .map((r) => r.split("|").map((c) => c.trim()).filter(Boolean))
      .filter((cells) => cells.length);
    if (!body.length) return "";
    const th = head.map((h) => `<th>${mdInline(h)}</th>`).join("");
    const trs = body
      .map((cells) => `<tr>${cells.map((c) => `<td>${mdInline(c)}</td>`).join("")}</tr>`)
      .join("");
    return `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
  }

  function mdToHtml(md) {
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let inCode = false;
    let codeBuf = [];
    let inTable = false;
    let tableBuf = [];
    let listBuf = [];

    const flushList = () => {
      if (listBuf.length) {
        html += `<ul>${listBuf.map((li) => `<li>${li}</li>`).join("")}</ul>`;
        listBuf = [];
      }
    };
    const flushTable = () => {
      if (inTable) {
        html += mdTable(tableBuf);
        tableBuf = [];
        inTable = false;
      }
    };

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          html += `<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`;
          codeBuf = [];
          inCode = false;
        } else {
          flushList(); flushTable();
          inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      const t = line.trim();
      if (!t) { flushList(); flushTable(); continue; }

      if (/^#{1,4} /.test(t)) {
        flushList(); flushTable();
        const level = t.match(/^#+/)[0].length;
        html += `<h${level + 1}>${mdInline(t.replace(/^#+ /, ""))}</h${level + 1}>`;
      } else if (/^\|/.test(t) && t.endsWith("|")) {
        if (!inTable) { flushList(); inTable = true; }
        tableBuf.push(t);
      } else if (/^- /.test(t)) {
        flushTable();
        listBuf.push(mdInline(t.replace(/^- /, "")));
      } else if (/^\d+\. /.test(t)) {
        flushTable();
        listBuf.push(mdInline(t.replace(/^\d+\. /, "")));
      } else {
        flushList(); flushTable();
        html += `<p>${mdInline(t)}</p>`;
      }
    }
    flushList(); flushTable();
    if (inCode) html += `<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`;
    return html;
  }


  /* 筛选 chips */

  const CAT_ORDER = ["项目", "笔记", "灵感", "阅读", "折腾", "关于"];

  function filters(entries, activeCategory) {
    const rank = (c) => {
      const i = CAT_ORDER.indexOf(c);
      return i === -1 ? 999 : i;
    };
    const cats = ["全部"].concat(
      [...new Set(entries.map((e) => e.category))].sort(
        (a, b) => rank(a) - rank(b)
      )
    );
    return cats
      .map(
        (c) =>
          `<button class="chip${c === activeCategory ? " is-active" : ""}" ` +
          `type="button" data-filter="${esc(c)}">${esc(c)}</button>`
      )
      .join("");
  }

  /* 卡片 */

  function card(e, i, vars) {
    const tags = (e.tags || [])
      .map(
        (t) =>
          `<button class="entry__tag" type="button" data-tag="${esc(t)}">#${esc(t)}</button>`
      )
      .join("");
    /* 显示与链接必须一致：source 是 GitHub 地址就链 GitHub 仓库，
       否则用 homepage（官网） */
    const srcHref =
      e.source && e.source.indexOf("github.com/") === 0
        ? e.url
        : e.homepage || e.url;
    const src = e.source
      ? srcHref
        ? `<a class="entry__src" href="${esc(srcHref)}" target="_blank" rel="noopener" ` +
          `title="${esc(e.source)}" aria-label="打开 ${esc(e.source)}">${esc(e.source)}</a>`
        : `<span class="entry__src" title="${esc(e.source)}">${esc(e.source)}</span>`
      : "";
    return (
      `<article class="entry is-entering" tabindex="0" role="button" style="--i:${i}" ` +
      `aria-label="打开条目 ${esc(e.id)}：${esc(e.title)}" data-id="${esc(e.id)}">` +
      `<span class="entry__meta">` +
      `<span class="entry__id">${esc(e.id)}</span>` +
      `<span class="entry__date">${esc(e.date)}</span>` +
      `<span class="entry__cat">${esc(e.category)}</span>` +
      (e.stars != null
        ? `<span class="entry__star" title="GitHub star 数">` +
          `<svg aria-hidden="true"><use href="#i-star"/></svg>${e.stars}</span>`
        : "") +
      `</span>` +
      `<h2 class="entry__title">${esc(applyTemplate(e.title, vars))}</h2>` +
      `<p class="entry__summary">${esc(applyTemplate(e.summary, vars))}</p>` +
      `<span class="entry__foot">` +
      (tags ? tags : "") +
      src +
      `</span>` +
      `</article>`
    );
  }

  function grid(list, el, vars) {
    if (!list.length) {
      el.innerHTML =
        `<div class="empty">没有匹配的条目<br>换个关键词试试</div>`;
      return;
    }
    el.innerHTML = list.map((e, i) => card(e, i, vars)).join("");
  }

  /* 模态 */

  function modal(e, bodyEl, entries, vars, readmeHtml) {
    const tags = (e.tags || [])
      .map(
        (t) =>
          `<button class="modal__tag" type="button" data-tag="${esc(t)}">#${esc(t)}</button>`
      )
      .join("");
    const links =
      e.homepage || e.url
        ? `<div class="modal__links">` +
          [e.homepage && { href: e.homepage, icon: "#i-home" },
           e.url && { href: e.url, icon: "#i-external" }]
            .filter(Boolean)
            .map(
              (l) =>
                `<a class="modal__link" href="${esc(l.href)}" target="_blank" rel="noopener">` +
                `<svg width="13" height="13" aria-hidden="true"><use href="${l.icon}"/></svg>` +
                `<span>${esc(l.href.replace(/^https?:\/\//, ""))}</span>` +
                `</a>`
            )
            .join("") +
          `</div>`
        : "";
    bodyEl.innerHTML =
      `<div class="modal__meta">` +
      `<span class="modal__id">${esc(e.id)}</span>` +
      `<span class="modal__date">${esc(e.date)}</span>` +
      `<span class="modal__cat">${esc(e.category)}</span>` +
      `</div>` +
      `<h2 class="modal__title">${esc(e.title)}</h2>` +
      paragraphs(e.body, entries, vars) +
      (readmeHtml
        ? `<div class="modal__readme"><h3 class="modal__sub">仓库 README</h3>${readmeHtml}</div>`
        : "") +
      links +
      (tags ? `<div class="modal__tags">${tags}</div>` : "") +
      `<div class="modal__uri">` +
      `<span class="modal__uri-code">${esc(uriOf(e.id))}</span>` +
      `<button class="entry__copy" type="button" data-copy="${esc(uriOf(e.id))}" aria-label="复制条目地址">` +
      `<svg width="13" height="13" aria-hidden="true"><use href="#i-copy"/></svg>` +
      `</button></div>`;
  }

  /* 模态搜索 */

  function searchResults(list, el) {
    if (!list.length) {
      el.innerHTML = `<div class="modal__search-empty">没有匹配的条目</div>`;
    } else {
      el.innerHTML = list
        .map(
          (h) =>
            `<button class="modal__search-item" type="button" data-jump="${esc(h.id)}">` +
            `<span class="item-id">${esc(h.id)}</span>` +
            `<span class="item-title">${esc(h.title)}</span></button>`
        )
        .join("");
    }
    el.classList.add("is-open");
  }

  return {
    esc,
    uriOf,
    hashOf,
    SITE,
    BRAND,
    applyTemplate,
    author,
    filters,
    card,
    grid,
    modal,
    searchResults,
    linkify,
    mdToHtml
  };
})();
