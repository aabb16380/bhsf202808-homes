/* ============================================================
   文章详情页
   ------------------------------------------------------------
   数据来源：content.one(slug)，数据库优先、静态兜底。
   阅读数：本会话第一次进某篇时 +1（走 RPC），之后只读。
   这个逻辑是踩过坑的——只 +1 不读回，管理员改完数还是 0。
   ============================================================ */
(function () {
  'use strict';

  var B8 = window.B8;
  if (!B8) return;

  var elCat = B8.qs('#a-cat');
  var elTitle = B8.qs('#a-title');
  var elMeta = B8.qs('#a-meta');
  var elBody = B8.qs('#a-body');
  var elViews = B8.qs('#a-views');
  var elNav = B8.qs('#a-nav');
  var elCrumb = B8.qs('#crumb-cat');
  var elRoot = B8.qs('#article');

  var slug = (function () {
    var m = (location.search || '').match(/[?&]slug=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  })();

  function catName(key) {
    var cats = B8.content.cats();
    return (cats[key] && cats[key].name) || key;
  }

  function notFound() {
    if (elRoot) {
      elRoot.innerHTML =
        '<header class="article-head">' +
          '<h1>这一篇不见了</h1>' +
          '<p class="article-meta">可能链接抄错了，或者作者把它删了。</p>' +
        '</header>' +
        '<p class="prose"><a class="link-arrow" href="index.html">回首页看看</a></p>';
    }
  }

  function render(post, list) {
    document.title = post.title + ' · 八班纪事';

    var canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute('href', 'https://bhsf202808.homes/article.html?slug=' + encodeURIComponent(post.slug));

    if (elCat) elCat.textContent = catName(post.cat);
    if (elCrumb) elCrumb.textContent = catName(post.cat);
    if (elTitle) elTitle.textContent = post.title;

    if (elMeta) {
      var bits = ['<time datetime="' + B8.esc(post.date) + '">' + B8.esc(B8.dateFull(post.date)) + '</time>'];
      if (post.byline) bits.push('<span>' + B8.esc(post.byline) + '</span>');
      if (post.words) bits.push('<span>' + post.words + ' 字</span>');
      elMeta.innerHTML = bits.join('<span class="dot-sep">·</span>');
    }

    if (elBody) elBody.innerHTML = B8.content.sanitize(post.body || '<p>（这一篇还没有正文。）</p>');

    // 阅读数
    B8.content.bumpView(post).then(function (n) {
      if (elViews && n != null) elViews.textContent = '阅读 ' + B8.num(n);
    });

    // 上一篇 / 下一篇
    if (elNav && list && list.length > 1) {
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].slug === post.slug) { i = k; break; }
      var newer = i > 0 ? list[i - 1] : null;
      var older = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
      var html = '';
      if (newer) {
        html += '<a href="article.html?slug=' + encodeURIComponent(newer.slug) + '">' +
          '<span class="pn-label">更新的一篇</span>' +
          '<span class="pn-title">' + B8.esc(newer.title) + '</span></a>';
      } else {
        html += '<span></span>';
      }
      if (older) {
        html += '<a href="article.html?slug=' + encodeURIComponent(older.slug) + '" style="text-align:right">' +
          '<span class="pn-label">更早的一篇</span>' +
          '<span class="pn-title">' + B8.esc(older.title) + '</span></a>';
      }
      elNav.innerHTML = html;
    }
  }

  function boot() {
    if (!elTitle) return;

    if (!slug) { notFound(); return; }

    B8.content.load().then(function (list) {
      return B8.content.one(slug).then(function (post) {
        if (!post) { notFound(); return; }
        render(post, list);
      });
    }).catch(function (err) {
      if (elRoot) {
        elRoot.innerHTML = '<p class="prose">读取失败：' + B8.esc(err && err.message ? err.message : '网络异常') +
          '</p><p class="prose"><a class="link-arrow" href="index.html">回首页</a></p>';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
