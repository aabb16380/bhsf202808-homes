/* ============================================================
   管理员：登录、发文/改文/删文
   ------------------------------------------------------------
   密钥只在登录那一次发给服务端，换回来的是一个 24 小时令牌。
   所有写操作都带令牌走 RPC——前端藏起来的东西不算数。
   ============================================================ */
(function () {
  'use strict';

  var B8 = window.B8;
  if (!B8) return;

  var cfg = (window.B8_CONFIG || {});
  if (cfg.features && cfg.features.admin === false) return;

  var elOpen = B8.qs('#admin-open');
  var panel = null;

  function close() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  function shell(inner) {
    close();
    panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = '<div class="admin-panel-inner">' + inner + '</div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) {
      if (e.target === panel) close();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    return panel;
  }

  /* ---------- 登录 ---------- */
  function showLogin() {
    var p = shell(
      '<h3>管理员登录</h3>' +
      '<p class="form-note" style="margin-bottom:16px">' +
        '输入管理员密钥。密钥和班级口令不是一回事，泄露了就去数据库里把 b8_keys 里那行 active 改成 false。' +
      '</p>' +
      '<form id="adm-form" novalidate>' +
        '<div class="field">' +
          '<label for="adm-key">管理员密钥</label>' +
          '<input class="input" id="adm-key" type="password" autocomplete="off" placeholder="B8-XXXX-XXXX-XXXX">' +
        '</div>' +
        '<div class="admin-foot">' +
          '<span class="form-status" id="adm-status"></span>' +
          '<div class="chip-row">' +
            '<button class="btn ghost sm" type="button" id="adm-cancel">取消</button>' +
            '<button class="btn sm" type="submit" id="adm-submit">登录</button>' +
          '</div>' +
        '</div>' +
      '</form>'
    );

    var input = B8.qs('#adm-key', p);
    var btn = B8.qs('#adm-submit', p);
    var status = B8.qs('#adm-status', p);
    if (input) input.focus();

    B8.on(B8.qs('#adm-cancel', p), 'click', close);

    B8.on(B8.qs('#adm-form', p), 'submit', function (e) {
      e.preventDefault();
      var key = B8.trim(input && input.value);
      if (key.length < 6) { status.textContent = '密钥太短'; return; }
      status.textContent = '验证中…';
      btn.disabled = true;

      B8.auth.login(key, '管理员').then(function (st) {
        if (st.kind !== 'admin') {
          B8.auth.logout();
          status.textContent = '这是班级口令，不是管理员密钥。';
          btn.disabled = false;
          return;
        }
        B8.toast('已进入管理员模式');
        if (elOpen) elOpen.textContent = '管理 · ' + (B8.auth.nick() || '已登录');
        showPanel();
      }).catch(function (err) {
        status.textContent = err && err.message ? err.message : '登录失败';
        btn.disabled = false;
      });
    });
  }

  /* ---------- 面板 ---------- */
  function showPanel() {
    var p = shell(
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
        '<h3 style="margin:0">文章管理</h3>' +
        '<div class="chip-row">' +
          '<span class="tag jade">' + B8.esc(B8.auth.nick() || '管理员') + '</span>' +
          '<button class="btn ghost sm" type="button" id="adm-new">新建</button>' +
          '<button class="btn ghost sm" type="button" id="adm-out">退出登录</button>' +
          '<button class="btn ghost sm" type="button" id="adm-close">关闭</button>' +
        '</div>' +
      '</div>' +
      '<div id="adm-list" style="margin-top:20px"><p class="form-note">正在读文章…</p></div>' +
      '<div id="adm-editor" hidden></div>'
    );

    B8.on(B8.qs('#adm-close', p), 'click', close);
    B8.on(B8.qs('#adm-out', p), 'click', function () { B8.auth.logout(); });
    B8.on(B8.qs('#adm-new', p), 'click', function () { showEditor(null); });

    loadList();
  }

  function loadList() {
    var host = B8.qs('#adm-list');
    if (!host) return;

    B8.content.load(true).then(function (list) {
      if (!list.length) {
        host.innerHTML = '<p class="form-note">还没有文章。</p>';
        return;
      }
      var html = '<div style="display:grid;gap:0">';
      list.forEach(function (post) {
        html +=
          '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;' +
          'padding:12px 0;border-top:1px solid var(--line)">' +
            '<div style="min-width:0">' +
              '<div style="font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                B8.esc(post.title) + '</div>' +
              '<div class="form-note">' + B8.esc(post.cat) + ' · ' + B8.esc(post.date) +
                ' · ' + B8.esc(post.slug) + '</div>' +
            '</div>' +
            '<div class="chip-row">' +
              '<button class="btn ghost sm" type="button" data-edit="' + B8.esc(post.slug) + '">编辑</button>' +
              '<button class="btn ghost sm" type="button" data-del="' + B8.esc(post.slug) + '">删除</button>' +
            '</div>' +
          '</div>';
      });
      html += '</div>';
      host.innerHTML = html;

      B8.qsa('[data-edit]', host).forEach(function (btn) {
        B8.on(btn, 'click', function () {
          var slug = btn.getAttribute('data-edit');
          var hit = null;
          list.forEach(function (x) { if (x.slug === slug) hit = x; });
          showEditor(hit);
        });
      });

      B8.qsa('[data-del]', host).forEach(function (btn) {
        B8.on(btn, 'click', function () {
          var slug = btn.getAttribute('data-del');
          if (!window.confirm('删除《' + slug + '》？数据库里删掉就没了（静态 md 还在）。')) return;
          btn.disabled = true;
          B8.sb.rpc('b8_post_delete', { p_token: B8.auth.token(), p_slug: slug })
            .then(function () {
              B8.toast('已删除');
              loadList();
              if (B8.onContentChange) B8.onContentChange();
            })
            .catch(function (err) {
              btn.disabled = false;
              B8.toast('删除失败：' + (err && err.message ? err.message : '网络异常'));
            });
        });
      });
    });
  }

  function showEditor(post) {
    var host = B8.qs('#adm-editor');
    var listHost = B8.qs('#adm-list');
    if (!host) return;

    var isNew = !post;
    var p = post || {
      slug: '', cat: 'news', title: '', date: new Date().toISOString().slice(0, 10),
      excerpt: '', byline: '', body: '', published: true
    };

    var cats = B8.content.cats();
    var catOpts = Object.keys(cats).map(function (k) {
      return '<option value="' + B8.esc(k) + '"' + (k === p.cat ? ' selected' : '') + '>' +
        B8.esc(cats[k].name) + '</option>';
    }).join('');

    host.innerHTML =
      '<h3 style="margin-top:26px">' + (isNew ? '新建文章' : '编辑：' + B8.esc(p.slug)) + '</h3>' +
      '<form id="adm-ed" novalidate style="margin-top:14px">' +
        '<div class="admin-row">' +
          '<div class="field"><label for="ed-slug">slug（英文、数字、连字符）</label>' +
            '<input class="input" id="ed-slug" value="' + B8.esc(p.slug) + '"' + (isNew ? '' : ' readonly') + '></div>' +
          '<div class="field"><label for="ed-cat">栏目</label>' +
            '<select class="input" id="ed-cat">' + catOpts + '</select></div>' +
        '</div>' +
        '<div class="field" style="margin-top:14px"><label for="ed-title">标题</label>' +
          '<input class="input" id="ed-title" value="' + B8.esc(p.title) + '"></div>' +
        '<div class="admin-row" style="margin-top:14px">' +
          '<div class="field"><label for="ed-date">日期</label>' +
            '<input class="input" id="ed-date" type="date" value="' + B8.esc(p.date) + '"></div>' +
          '<div class="field"><label for="ed-byline">署名</label>' +
            '<input class="input" id="ed-byline" value="' + B8.esc(p.byline || '') + '"></div>' +
        '</div>' +
        '<div class="field" style="margin-top:14px"><label for="ed-excerpt">摘要（列表里显示两行）</label>' +
          '<input class="input" id="ed-excerpt" value="' + B8.esc(p.excerpt || '') + '"></div>' +
        '<div class="field" style="margin-top:14px"><label for="ed-body">正文（可以是 HTML）</label>' +
          '<textarea class="textarea" id="ed-body" rows="12" style="font-family:var(--mono);font-size:13.5px">' +
            B8.esc(p.body || '') + '</textarea></div>' +
        '<div class="admin-foot">' +
          '<span class="form-status" id="ed-status"></span>' +
          '<div class="chip-row">' +
            '<button class="btn ghost sm" type="button" id="ed-cancel">收起</button>' +
            '<button class="btn sm" type="submit" id="ed-save">保存</button>' +
          '</div>' +
        '</div>' +
      '</form>';

    host.hidden = false;
    if (listHost) listHost.hidden = true;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    B8.on(B8.qs('#ed-cancel', host), 'click', function () {
      host.hidden = true;
      host.innerHTML = '';
      if (listHost) listHost.hidden = false;
    });

    B8.on(B8.qs('#adm-ed', host), 'submit', function (e) {
      e.preventDefault();
      var status = B8.qs('#ed-status', host);
      var slug = B8.trim(B8.qs('#ed-slug', host).value);
      var title = B8.trim(B8.qs('#ed-title', host).value);

      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        status.textContent = 'slug 只能用英文小写、数字和连字符';
        status.className = 'form-status err';
        return;
      }
      if (!title) {
        status.textContent = '标题不能为空';
        status.className = 'form-status err';
        return;
      }

      var payload = {
        slug: slug,
        cat: B8.qs('#ed-cat', host).value,
        title: title,
        date: B8.qs('#ed-date', host).value || null,
        excerpt: B8.trim(B8.qs('#ed-excerpt', host).value, 120),
        byline: B8.trim(B8.qs('#ed-byline', host).value, 40),
        body: B8.qs('#ed-body', host).value,
        published: true
      };

      var saveBtn = B8.qs('#ed-save', host);
      saveBtn.disabled = true;
      status.textContent = '保存中…';
      status.className = 'form-status';

      B8.sb.rpc('b8_post_save', { p_token: B8.auth.token(), p_post: payload })
        .then(function (res) {
          if (!res || !res.ok) throw new Error('服务端没有确认写入');
          status.textContent = '已保存';
          status.className = 'form-status ok';
          B8.toast('文章已保存');
          if (B8.onContentChange) B8.onContentChange();
          loadList();
          host.hidden = true;
          host.innerHTML = '';
          if (listHost) listHost.hidden = false;
        })
        .catch(function (err) {
          status.textContent = '保存失败：' + (err && err.message ? err.message : '网络异常');
          status.className = 'form-status err';
        })
        .then(function () { saveBtn.disabled = false; });
    });
  }

  /* ---------- 入口 ---------- */
  function boot() {
    if (!elOpen) return;
    elOpen.hidden = false;

    B8.on(elOpen, 'click', function () {
      if (B8.auth && B8.auth.isAdmin()) showPanel();
      else showLogin();
    });

    if (B8.auth && B8.auth.isAdmin()) {
      elOpen.textContent = '管理 · ' + (B8.auth.nick() || '已登录');
    }

    document.addEventListener('b8:auth', function () {
      if (B8.auth.isAdmin()) {
        elOpen.textContent = '管理 · ' + (B8.auth.nick() || '已登录');
      } else {
        elOpen.textContent = '管理员';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
