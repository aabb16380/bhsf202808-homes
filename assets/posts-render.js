/* ============================================================
   首页渲染：新鲜事列表 + 活动卡片
   ------------------------------------------------------------
   同一份数据（content.js 合并后的文章）出两种视图：
     · 列表：按栏目筛选、按时间/阅读排序、分页
     · 卡片：只取 cat=activity 的前四张，封面用 CSS 渐变
   ============================================================ */
(function () {
  'use strict';

  var B8 = window.B8;
  if (!B8) return;

  var PAGE = 6;
  var state = { cat: 'all', sort: 'new', shown: PAGE, list: [] };

  var elList = B8.qs('#post-list');
  var elFilter = B8.qs('#cat-filter');
  var elSort = B8.qs('#sort-bar');
  var elEmpty = B8.qs('#post-empty');
  var elMore = B8.qs('#more-btn');
  var elNote = B8.qs('#post-note');
  var elActs = B8.qs('#act-grid');
  var elActsEmpty = B8.qs('#act-empty');

  function catName(key) {
    var cats = B8.content.cats();
    return (cats[key] && cats[key].name) || key;
  }

  /* ---------- 筛选项 ---------- */
  function renderFilters() {
    var cats = B8.content.cats();
    var html = '<button class="chip on" type="button" data-cat="all" aria-pressed="true">全部</button>';
    Object.keys(cats).forEach(function (key) {
      html += '<button class="chip" type="button" data-cat="' + B8.esc(key) + '" aria-pressed="false">' +
        B8.esc(cats[key].name) + '</button>';
    });
    elFilter.innerHTML = html;

    elFilter.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip') : null;
      if (!btn) return;
      state.cat = btn.getAttribute('data-cat');
      state.shown = PAGE;
      B8.qsa('.chip', elFilter).forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderList();
    });

    elSort.innerHTML =
      '<button class="chip on" type="button" data-sort="new" aria-pressed="true">最新</button>' +
      '<button class="chip" type="button" data-sort="views" aria-pressed="false">阅读最多</button>';

    elSort.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.chip') : null;
      if (!btn) return;
      state.sort = btn.getAttribute('data-sort');
      B8.qsa('.chip', elSort).forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderList();
    });
  }

  /* ---------- 列表 ---------- */
  function pick() {
    var rows = state.list.filter(function (p) {
      return state.cat === 'all' || p.cat === state.cat;
    });
    if (state.sort === 'views') {
      rows.sort(function (a, b) { return (b.views || 0) - (a.views || 0); });
    }
    return rows;
  }

  function renderList() {
    var rows = pick();

    if (!rows.length) {
      elList.innerHTML = '';
      elEmpty.hidden = false;
      elMore.hidden = true;
      return;
    }
    elEmpty.hidden = true;

    var slice = rows.slice(0, state.shown);
    var html = '';

    slice.forEach(function (p) {
      var meta = [];
      if (p.byline) meta.push(B8.esc(p.byline));
      if (p.views) meta.push('阅读 ' + B8.num(p.views));

      html +=
        '<article class="post-item">' +
          '<a class="post-link" href="article.html?slug=' + encodeURIComponent(p.slug) + '">' +
            '<div class="post-top">' +
              '<span class="tag">' + B8.esc(catName(p.cat)) + '</span>' +
              '<time datetime="' + B8.esc(p.date) + '">' + B8.esc(B8.dateFull(p.date)) + '</time>' +
            '</div>' +
            '<h3 class="post-title">' + B8.esc(p.title) + '</h3>' +
            '<p class="post-excerpt">' + B8.esc(p.excerpt) + '</p>' +
            '<div class="post-meta-row">' + (meta.length ? '<span>' + meta.join(' · ') + '</span>' : '') + '</div>' +
            '<div class="post-more">阅读全文 →</div>' +
          '</a>' +
        '</article>';
    });

    elList.innerHTML = html;

    elMore.hidden = rows.length <= state.shown;
    if (!elMore.hidden) {
      elMore.textContent = '展开更多（还有 ' + (rows.length - state.shown) + ' 篇）';
    }
  }

  B8.on(elMore, 'click', function () {
    state.shown += PAGE;
    renderList();
  });

  /* ---------- 活动卡片 ---------- */
  var TONES = 5;

  function renderActs() {
    var acts = state.list.filter(function (p) { return p.cat === 'activity'; }).slice(0, 4);

    if (!acts.length) {
      elActs.innerHTML = '';
      elActsEmpty.hidden = false;
      return;
    }
    elActsEmpty.hidden = true;

    var html = '';
    acts.forEach(function (p, i) {
      var no = (i + 1 < 10 ? '0' : '') + (i + 1);
      var meta = [];
      if (p.byline) meta.push(B8.esc(p.byline));
      if (p.views) meta.push('阅读 ' + B8.num(p.views));

      html +=
        '<a class="act" href="article.html?slug=' + encodeURIComponent(p.slug) + '">' +
          '<div class="act-cover tone-' + ((i % TONES) + 1) + '">' +
            '<span class="act-date-badge">' + B8.esc(B8.date(p.date)) + '</span>' +
            '<span class="act-no">' + no + '</span>' +
          '</div>' +
          '<div class="act-body">' +
            '<h3>' + B8.esc(p.title) + '</h3>' +
            '<p>' + B8.esc(p.excerpt) + '</p>' +
            '<div class="act-meta">' + (meta.length ? meta.join('<span>·</span>') : '<span>活动记录</span>') + '</div>' +
          '</div>' +
        '</a>';
    });
    elActs.innerHTML = html;
  }

  /* ---------- 给管理员用的刷新钩子 ---------- */
  B8.onContentChange = function () {
    return B8.content.load(true).then(function (list) {
      state.list = list;
      state.shown = Math.max(state.shown, PAGE);
      renderList();
      renderActs();
    });
  };

  /* ---------- 启动 ---------- */
  function boot() {
    if (!elList) return;
    renderFilters();

    elNote.textContent = '正在取文章…';

    B8.content.load().then(function (list) {
      state.list = list;
      renderList();
      renderActs();

      if (B8.content.source() === 'db') {
        elNote.textContent = '';
      } else if (B8.content.error()) {
        elNote.textContent = '暂时连不上数据库，先看静态版本：' + (B8.content.error().message || '');
        elNote.style.color = 'var(--seal)';
      } else {
        elNote.textContent = '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
