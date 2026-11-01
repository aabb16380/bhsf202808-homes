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

  /* ---------- 管理员：在这一页直接改 / 删 ---------- */

  var CATS = { news: '新鲜事', activity: '活动', notice: '通知', essay: '随笔' };

  function adminBar(post) {
    var bar = document.createElement('div');
    bar.className = 'article-admin';
    bar.id = 'article-admin';

    var edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn sm';
    edit.textContent = '编辑这篇';

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn ghost sm';
    del.textContent = '删除';

    var hint = document.createElement('span');
    hint.className = 'article-admin-hint';
    hint.id = 'article-admin-status';

    bar.appendChild(edit);
    bar.appendChild(del);
    bar.appendChild(hint);

    B8.on(edit, 'click', function () { openEditor(post); });
    B8.on(del, 'click', removePost);

    return bar;
  }

  function removePost() {
    if (!window.confirm('删掉《' + (document.title.split(' · ')[0] || '这篇') + '》？删了就不能恢复。')) return;
    var st = document.getElementById('article-admin-status');
    if (st) st.textContent = '正在删除…';
    B8.sb.rpc('b8_post_delete', { p_token: B8.auth.token(), p_slug: slug })
      .then(function () {
        B8.toast('已删除');
        location.href = 'index.html';
      })
      .catch(function (err) {
        if (st) st.textContent = (err && err.message ? err.message : '删除失败');
      });
  }

  function openEditor(post) {
    var old = document.getElementById('art-editor');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var wrap = document.createElement('div');
    wrap.id = 'art-editor';
    wrap.className = 'modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');

    var catOpts = '';
    Object.keys(CATS).forEach(function (k) {
      catOpts += '<option value="' + k + '"' +
        ((post.cat === k) ? ' selected' : '') + '>' + CATS[k] + '</option>';
    });

    wrap.innerHTML =
      '<div class="modal-inner art-editor-inner">' +
        '<h3 class="modal-title">编辑文章</h3>' +
        '<div class="field"><label for="ae-title">标题</label>' +
          '<input class="input" id="ae-title" maxlength="60"></div>' +
        '<div class="art-editor-row">' +
          '<div class="field"><label for="ae-cat">分类</label>' +
            '<select class="input" id="ae-cat">' + catOpts + '</select></div>' +
          '<div class="field"><label for="ae-date">日期</label>' +
            '<input class="input" id="ae-date" type="date"></div>' +
        '</div>' +
        '<div class="field"><label for="ae-body">正文（支持 HTML）</label>' +
          '<textarea class="textarea" id="ae-body" rows="14"></textarea></div>' +
        '<div class="modal-actions">' +
          '<button class="btn ghost sm" type="button" id="ae-cancel">取消</button>' +
          '<button class="btn sm" type="button" id="ae-save">保存</button>' +
        '</div>' +
        '<p class="form-status" id="ae-status"></p>' +
      '</div>';

    document.body.appendChild(wrap);

    var tEl = document.getElementById('ae-title');
    var cEl = document.getElementById('ae-cat');
    var dEl = document.getElementById('ae-date');
    var bEl = document.getElementById('ae-body');
    var st = document.getElementById('ae-status');
    var saveBtn = document.getElementById('ae-save');

    tEl.value = post.title || '';
    dEl.value = String(post.date || '').slice(0, 10);
    bEl.value = post.body || '';

    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    B8.on(document.getElementById('ae-cancel'), 'click', close);
    B8.on(wrap, 'click', function (e) { if (e.target === wrap) close(); });

    B8.on(saveBtn, 'click', function () {
      var title = (tEl.value || '').trim();
      var body = bEl.value || '';
      if (!title) { st.className = 'form-status err'; st.textContent = '标题不能空'; return; }

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      st.className = 'form-status';
      st.textContent = '';

      B8.sb.rpc('b8_post_save', {
        p_token: B8.auth.token(),
        p_post: {
          slug: post.slug,
          title: title,
          cat: cEl.value,
          date: dEl.value || null,
          excerpt: post.excerpt || '',
          byline: post.byline || '',
          body: body,
          published: true
        }
      }).then(function () {
        st.className = 'form-status ok';
        st.textContent = '保存了，正在刷新…';
        location.reload();
      }).catch(function (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
        st.className = 'form-status err';
        st.textContent = (err && err.message) ? err.message : '保存失败';
      });
    });

    setTimeout(function () { tEl.focus(); }, 80);
  }
  var lastPost = null;

  function render(post, list) {
    lastPost = post;
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

    // 管理员在这一页就能改 / 删，不用回列表找按钮
    if (B8.auth && B8.auth.isAdmin && B8.auth.isAdmin() && elRoot) {
      var host = elRoot.querySelector('.article-foot') || elRoot;
      if (!document.getElementById('article-admin')) {
        host.parentNode ? host.parentNode.insertBefore(adminBar(post), host) : host.appendChild(adminBar(post));
      }
    }

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
  // 提权（输密钥）之后不刷新页面，直接把管理员工具条补上
  document.addEventListener('b8:auth', function () {
    if (!B8.auth || !B8.auth.isAdmin || !B8.auth.isAdmin()) return;
    if (!lastPost || !elRoot || document.getElementById('article-admin')) return;
    var host2 = elRoot.querySelector('.article-foot');
    var bar = adminBar(lastPost);
    if (host2 && host2.parentNode) host2.parentNode.insertBefore(bar, host2);
    else elRoot.parentNode.insertBefore(bar, elRoot.nextSibling);
  });
})();
