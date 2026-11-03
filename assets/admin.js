/* ============================================================
   八班纪事 · 管理后台  v2.0 · 构建 20261101b1
   ------------------------------------------------------------
   为什么重写：v2 把「班级口令」换成了「学号 + 密码」，
   管理员还要再叠一层 2 小时的密钥提权（B8.auth.useKey）。
   v1 的 B8.auth.login() 已经不存在了，旧后台连门都进不去。

   身份三档，入口按钮点下去分别处理：
     none         → 引到右上角账号面板去登录学号（不在这里抢登录）
     member       → 弹密钥小窗，useKey() 成功后自动进后台
     admin/super  → 直接进后台

   所有写操作都带 B8.auth.token() 走 RPC：前端藏按钮不算权限，
   服务端 b8_verify() 才是那道门。
   ============================================================ */
(function () {
  'use strict';

  var B8 = window.B8;
  // 只接管 v2 账号模块（useKey / isSuper 是 v2 才有的）；旧 auth.js 缓存在
  // 用户机器上时，宁可什么都不做，也不要弹出一个登录必然失败的旧后台。
  if (!B8 || !B8.auth || typeof B8.auth.useKey !== 'function') return;

  var cfg = window.B8_CONFIG || {};
  if (cfg.features && cfg.features.admin === false) return;

  var VERSION = 'v2.0';
  var BUILD = '20261101b1';

  var elOpen = B8.qs('#admin-open');
  var panel = null;          // 管理面板根节点（.modal）
  var dialog = null;         // 叠在面板上的一层小弹窗（输密钥 / 重置密码）
  var panelEsc = null;
  var dialogEsc = null;

  var state = {
    authSettled: false,      // auth.js 是否已经核完令牌
    authWait: false,         // 正在等 auth 落定，避免连点排一串回调
    tab: 'posts',
    seq: 0,                  // 每次切 tab 自增，异步回来的旧响应靠它作废
    posts: [],
    gb: [],
    editing: 0,              // 正在就地编辑的留言 id（0 = 没在编辑）
    draft: '',
    keys: [],
    members: []
  };

  /* ---------- 小工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function errText(err) {
    return (err && err.message) ? err.message : '网络异常';
  }

  // 三个状态里的「加载中」；空和失败各有各的写法，见下面两个
  function loadingHtml(text) {
    return '<p class="modal-note" style="margin-top:14px">' + B8.esc(text) + '</p>';
  }

  function emptyHtml(text) {
    return '<p class="gb-empty">' + B8.esc(text) + '</p>';
  }

  // 失败时把服务端 message 原样贴出来：「操作失败」三个字对用户没有帮助
  function failHtml(prefix, err) {
    return '<p class="form-status err" style="margin-top:14px">' +
      B8.esc((prefix || '') + errText(err)) + '</p>';
  }

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  // 本地日期：toISOString() 是 UTC，北京时间早上 8 点前会串成前一天
  function today() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function nick() {
    return B8.auth.nick() || '（未署名）';
  }

  // elevLabel() 是密钥表里的 label（「管理员 01」这种），空的话退回身份名
  function elevLabel() {
    return B8.auth.elevLabel() || (B8.auth.isSuper() ? '超级管理员' : '管理员');
  }

  /* ---------- A. 入口：先判断身份 ---------- */

  // 提权后把身份写在角标上，省得用户忘了自己还开着管理员权限
  function syncEntry() {
    if (!elOpen) return;
    elOpen.textContent = B8.auth.isAdmin() ? ('管理 · ' + (B8.auth.nick() || '已登录')) : '管理员';
  }

  function onOpenClick() {
    if (!B8.sb || !B8.sb.ready) {
      B8.toast('数据库还没接：先填 assets/site-config.js');
      return;
    }

    // auth.js 启动时要拿令牌去服务端核一次（b8_check）；这几十毫秒里
    // isLogged() 还是 false。点太早就等它落定（最多 1.5 秒），
    // 免得把一个已经登录的同学赶去重新登录。
    if (!state.authSettled) {
      if (state.authWait) return;
      state.authWait = true;
      var fired = false;
      var again = function () {
        if (fired) return;          // ready 与超时只会生效一次
        fired = true;
        state.authWait = false;
        onOpenClick();
      };
      if (typeof B8.auth.ready === 'function') B8.auth.ready(again);
      setTimeout(function () {
        if (state.authSettled || fired) return;
        // auth.js 迟迟不落定（比如脚本半天没启动）：按当前状态处理，
        // 别让入口按钮卡在"等一下再点"上。
        state.authSettled = true;
        again();
      }, 1500);
      return;
    }

    if (!B8.auth.isLogged()) {
      B8.toast('先去右上角登录学号');
      var acct = document.getElementById('acct-btn');
      if (acct && acct.click) acct.click();
      return;
    }

    // 不管是不是管理员都进面板：不是管理员就在面板里给一个密钥输入框，
    // 至少让人看得见文章列表和「新建文章」在哪，而不是弹个 toast 就没了。
    openPanel();
  }

  /* ---------- 通用小弹窗（只问一个值） ---------- */

  function closeDialog() {
    if (dialogEsc) {
      document.removeEventListener('keydown', dialogEsc);
      dialogEsc = null;
    }
    if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
    dialog = null;
  }

  /**
   * openDialog({title, note, label, type, placeholder, confirmText,
   *             validate, onSubmit, onDone})
   * onSubmit(value) 返回 Promise：resolve 才关窗，reject 把 message 原样显示。
   * 遮罩、Esc、取消都只关这一层，不动下面的管理面板。
   */
  function openDialog(opts) {
    closeDialog();

    var el = document.createElement('div');
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="modal-inner" style="width:min(440px,100%)">' +
        '<h3 class="modal-title">' + B8.esc(opts.title) + '</h3>' +
        // note 是这里写死的文案，动态部分（姓名/学号）已由调用方 esc 过
        '<p class="modal-note">' + (opts.note || '') + '</p>' +
        '<div class="field" style="margin-top:16px">' +
          '<label for="adm-dlg-input">' + B8.esc(opts.label || '') + '</label>' +
          '<input class="input" id="adm-dlg-input" type="' + (opts.type || 'text') + '"' +
            ' autocomplete="off" spellcheck="false"' +
            ' placeholder="' + B8.esc(opts.placeholder || '') + '">' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn ghost sm" type="button" id="adm-dlg-cancel">取消</button>' +
          '<button class="btn sm" type="button" id="adm-dlg-ok">' +
            B8.esc(opts.confirmText || '确定') + '</button>' +
        '</div>' +
        '<p class="form-status err" id="adm-dlg-err"></p>' +
      '</div>';
    document.body.appendChild(el);
    dialog = el;

    var input = B8.qs('#adm-dlg-input', el);
    var okBtn = B8.qs('#adm-dlg-ok', el);
    var errBox = B8.qs('#adm-dlg-err', el);

    function fail(msg) {
      if (errBox) errBox.textContent = msg || '';
    }

    function submit() {
      var v = input ? input.value : '';
      if (opts.validate) {
        var msg = opts.validate(v);
        if (msg) { fail(msg); if (input) input.focus(); return; }
      }
      if (okBtn) okBtn.disabled = true;
      fail('');

      var run;
      try { run = opts.onSubmit(v); } catch (e) { run = Promise.reject(e); }

      Promise.resolve(run).then(function (res) {
        closeDialog();
        if (opts.onDone) opts.onDone(res);
      }).catch(function (err) {
        if (okBtn) okBtn.disabled = false;
        fail(errText(err));          // 「密钥不对」「这把密钥已被停用」都原样给
      });
    }

    B8.on(B8.qs('#adm-dlg-cancel', el), 'click', closeDialog);
    B8.on(okBtn, 'click', submit);
    B8.on(el, 'click', function (e) { if (e.target === el) closeDialog(); });
    B8.on(input, 'keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    dialogEsc = function (e) {
      if (e.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', dialogEsc);

    setTimeout(function () { if (input) input.focus(); }, 60);
  }

  // 已登录但没提权：输管理员密钥
  function askKey() {
    openDialog({
      title: '输入管理员密钥',
      note: '你已经用学号登录（' + B8.esc(nick()) + '）。' +
        '<br>一人一钥：第一次用哪把，这把钥匙就绑给你的学号，别人再拿到也用不了。' +
        '<br>权限 2 小时有效；关掉标签页就没了，下次进来要重新输。',
      label: '管理员密钥',
      type: 'text',            // 不能用 password：手机上会切安全键盘，粘贴不了
      placeholder: 'B8-XXXX-XXXX-XXXX',
      confirmText: '启用',
      validate: function (v) {
        return String(v || '').trim().length < 6 ? '密钥太短' : '';
      },
      onSubmit: function (v) { return B8.auth.useKey(v); },
      onDone: function (elev) {
        B8.toast('管理员权限已启用：' + ((elev && elev.label) || elevLabel()));
        openPanel();
      }
    });
  }

  /* ---------- B. 管理面板 ---------- */

  function closePanel() {
    closeDialog();
    if (panelEsc) {
      document.removeEventListener('keydown', panelEsc);
      panelEsc = null;
    }
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    state.tab = 'posts';
    state.seq += 1;               // 作废所有还在路上的响应
    state.posts = [];
    state.gb = [];
    state.keys = [];
    state.members = [];
    state.editing = 0;
    state.draft = '';
  }

  /* 不是管理员时先看到这个：说明状态 + 一个密钥输入框 */
  function openLockedPanel() {
    closeDialog();
    closePanel();

    panel = document.createElement('div');
    panel.className = 'modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML =
      '<div class="modal-inner" style="width:min(520px,100%)">' +
        '<h3 class="modal-title">管理后台</h3>' +
        '<p class="modal-note">' +
          (B8.auth.isLogged()
            ? '你已经登录（' + B8.esc(nick()) + '），但这个账号还不是管理员。'
            : '还没登录。先用学号登录，再输一次管理员密钥。') +
        '</p>' +
        (B8.auth.isLogged()
          ? '<div class="field" style="margin-top:16px">' +
              '<label for="adm-key-inline">管理员密钥</label>' +
              '<input class="input" id="adm-key-inline" type="text" ' +
                'placeholder="B8-XXXX-XXXX-XXXX" autocomplete="off" ' +
                'autocapitalize="characters" spellcheck="false">' +
              '<p class="modal-note" style="margin-top:6px">' +
                '一人一钥，第一次用哪把就永久绑给你，以后不用再输。</p>' +
            '</div>' +
            '<div class="modal-actions">' +
              '<button class="btn ghost sm" type="button" id="adm-lock-close">关闭</button>' +
              '<button class="btn sm" type="button" id="adm-lock-go">启用密钥</button>' +
            '</div>' +
            '<p class="form-status" id="adm-lock-status"></p>'
          : '<div class="modal-actions"><button class="btn sm" type="button" id="adm-lock-close">知道了</button></div>') +
      '</div>';
    document.body.appendChild(panel);

    B8.on($('adm-lock-close'), 'click', closePanel);

    var keyIn = $('adm-key-inline');
    var go = $('adm-lock-go');
    var st = $('adm-lock-status');
    if (!keyIn || !go) return;

    function submitKey() {
      var v = B8.trim ? B8.trim(keyIn.value, 40) : String(keyIn.value || '').trim();
      if (v.length < 6) { if (st) { st.className = 'form-status err'; st.textContent = '密钥太短'; } return; }
      go.disabled = true;
      go.textContent = '验证中…';
      B8.auth.useKey(v).then(function () {
        B8.toast('管理员权限已启用');
        openPanel();
      }).catch(function (err) {
        go.disabled = false;
        go.textContent = '启用密钥';
        if (st) { st.className = 'form-status err'; st.textContent = errText(err); }
      });
    }

    B8.on(go, 'click', submitKey);
    B8.on(keyIn, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitKey(); } });
    setTimeout(function () { keyIn.focus(); }, 80);
  }

  function openPanel() {
    if (!B8.auth.isAdmin()) { openLockedPanel(); return; }
    closeDialog();
    closePanel();

    panel = document.createElement('div');
    panel.className = 'modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '管理后台');
    panel.innerHTML =
      // .modal-inner 默认 460px，后台要表格，这里用内联样式放宽到 920px。
      // 不加 tabindex / focus()：base.css 的 :focus-visible 会给整块面板描红边，
      // 看着像报错；Esc 监听在 document 上，不依赖焦点。
      '<div class="modal-inner" id="adm-inner"' +
        ' style="width:min(920px,100%);max-height:88vh">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;' +
          'gap:14px;flex-wrap:wrap">' +
          '<div style="min-width:0">' +
            '<h3 class="modal-title" style="margin-bottom:4px">管理后台</h3>' +
            '<p class="modal-note">' +
              '<strong style="color:var(--ink)">' + B8.esc(nick()) + '</strong> · ' +
              '<span class="tag">' + B8.esc(elevLabel()) + '</span>' +
            '</p>' +
          '</div>' +
          '<div class="chip-row">' +
            '<button class="btn ghost sm" type="button" id="adm-drop">退出管理员</button>' +
            '<button class="btn ghost sm" type="button" id="adm-close">关闭</button>' +
          '</div>' +
        '</div>' +
        '<div class="chip-row" id="adm-tabs"' +
          ' style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)"></div>' +
        '<div id="adm-body" style="margin-top:16px"></div>' +
        '<p class="modal-note" style="margin-top:20px;padding-top:12px;' +
          'border-top:1px solid var(--line)">管理后台 ' +
          B8.esc(VERSION) + ' · ' + B8.esc(BUILD) + '</p>' +
      '</div>';
    document.body.appendChild(panel);

    // 点遮罩关面板（点弹窗内容不算）
    B8.on(panel, 'click', function (e) { if (e.target === panel) closePanel(); });

    panelEsc = function (e) {
      if (e.key !== 'Escape') return;
      if (dialog) { closeDialog(); return; }   // 先关最上面那层
      closePanel();
    };
    document.addEventListener('keydown', panelEsc);

    B8.on($('adm-close'), 'click', closePanel);

    B8.on($('adm-drop'), 'click', function () {
      var btn = $('adm-drop');
      if (btn) btn.disabled = true;
      // dropKey() 会让服务端删掉这条 2 小时的提权会话，然后整页刷新，
      // 页面回到「只登录、没提权」的状态，角标也跟着变回去。
      B8.auth.dropKey().then(function () {
        closePanel();
        location.reload();
      });
    });

    var inner = $('adm-inner');
    if (inner && inner.scrollTop) inner.scrollTop = 0;

    renderTabs();
    switchTab('posts');
  }

  function tabs() {
    var list = [
      { id: 'posts', name: '文章' },
      { id: 'guest', name: '留言' }
    ];
    if (B8.auth.isSuper()) {
      list.push({ id: 'keys', name: '密钥' });
      list.push({ id: 'members', name: '成员' });
    }
    return list;
  }

  function renderTabs() {
    var host = $('adm-tabs');
    if (!host) return;
    var html = '';
    tabs().forEach(function (t) {
      var on = t.id === state.tab;
      html += '<button class="chip' + (on ? ' on' : '') + '" type="button"' +
        ' data-tab="' + B8.esc(t.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        B8.esc(t.name) + '</button>';
    });
    host.innerHTML = html;

    B8.qsa('[data-tab]', host).forEach(function (btn) {
      B8.on(btn, 'click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
  }

  function switchTab(name) {
    state.tab = name;
    state.seq += 1;
    state.editing = 0;
    state.draft = '';
    renderTabs();

    var inner = $('adm-inner');
    if (inner) inner.scrollTop = 0;

    var body = $('adm-body');
    if (!body) return;
    body.innerHTML = '';

    if (name === 'posts') { loadPostsTab(); return; }
    if (name === 'guest') { loadGuestTab(); return; }
    if (name === 'keys') { loadKeysTab(); return; }
    if (name === 'members') { loadMembersTab(); return; }
  }

  /* ---------- B1. 文章 ---------- */

  function fetchPosts(force) {
    if (!B8.content || !B8.content.load) {
      return Promise.reject(new Error('内容层没加载：assets/content.js 缺失'));
    }
    return B8.content.load(!!force);
  }

  // 写完之后的统一收尾：先让公开首页重画（posts-render.js 暴露的钩子），
  // 再读一次合并结果给自己用。第二次读 content.js 的 5 分钟缓存，
  // 不会为了刷新后台列表再打一遍 300 篇的查询。
  function afterWrite() {
    var p = (B8.onContentChange ? B8.onContentChange() : Promise.resolve());
    return p.then(function () {
      return fetchPosts(false);
    }).catch(function (err) {
      // 数据其实已经写进去了，这里只是刷新失败，不能让用户以为白写了
      B8.toast('已写入，但列表没刷新：' + errText(err));
      return null;
    });
  }

  function loadPostsTab() {
    var body = $('adm-body');
    if (!body) return;
    var seq = state.seq;

    body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'gap:12px;flex-wrap:wrap">' +
        '<p class="modal-note" id="adm-post-count">正在读文章…</p>' +
        '<button class="btn sm" type="button" id="adm-new">新建文章</button>' +
      '</div>' +
      '<div id="adm-post-editor" hidden></div>' +
      '<div id="adm-post-list"></div>' +
      '<p class="modal-note" style="margin-top:16px">删除只删数据库里那一行；' +
        '如果同 slug 的静态 md 还在，列表会回落到 md 版本。</p>';

    B8.on($('adm-new'), 'click', function () { showEditor(null); });

    fetchPosts(true).then(function (list) {
      if (seq !== state.seq) return;         // tab 已经切走了，别往旧位置写
      renderPostList(list);
    }).catch(function (err) {
      if (seq !== state.seq) return;
      var count = $('adm-post-count');
      if (count) count.textContent = '';
      var host = $('adm-post-list');
      if (host) host.innerHTML = failHtml('文章没读到：', err);
    });
  }

  function renderPostList(list) {
    state.posts = list || [];
    var host = $('adm-post-list');
    var count = $('adm-post-count');
    if (count) count.textContent = '共 ' + state.posts.length + ' 篇';
    if (!host) return;

    // content.js 读库失败会回落到静态版（Promise 仍然成功），
    // 所以失败提示要从 content.error() 里捞，不能只靠 catch。
    var warn = '';
    if (!B8.sb || !B8.sb.ready) {
      warn = failHtml('数据库未配置，下面只有静态文章：', new Error('先填 assets/site-config.js'));
    } else if (B8.content && B8.content.error && B8.content.error()) {
      warn = failHtml('数据库没读到，下面是静态版：', B8.content.error());
    }

    if (!state.posts.length) {
      host.innerHTML = warn + emptyHtml('还没有文章。点右上角「新建文章」写第一篇。');
      return;
    }

    var cats = (B8.content && B8.content.cats) ? B8.content.cats() : {};
    var html = '';
    for (var i = 0; i < state.posts.length; i++) {
      var p = state.posts[i];
      var cname = (cats[p.cat] && cats[p.cat].name) || p.cat || '未分类';
      html +=
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;' +
          'align-items:center;padding:12px 0;border-top:1px solid var(--line)">' +
          '<div style="min-width:0">' +
            '<div style="font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
              B8.esc(p.title) + '</div>' +
            '<div class="modal-note" style="font-size:11.5px;display:flex;align-items:center;' +
              'gap:8px;flex-wrap:wrap;margin-top:2px">' +
              '<span class="tag">' + B8.esc(cname) + '</span>' +
              '<span>' + B8.esc(p.date ? B8.date(p.date) : '无日期') + '</span>' +
              '<span class="mono">' + B8.esc(p.slug) + '</span>' +
              '<span>阅读 ' + B8.num(p.views) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="chip-row">' +
            '<button class="btn ghost sm" type="button" data-edit="' + i + '">编辑</button>' +
            '<button class="btn ghost sm" type="button" data-del="' + i + '">删除</button>' +
          '</div>' +
        '</div>';
    }
    host.innerHTML = warn + html;

    // 用下标而不是 slug 记行：列表随时会重排，下标总是指向刚看到的那一篇
    B8.qsa('[data-edit]', host).forEach(function (btn) {
      B8.on(btn, 'click', function () {
        var post = state.posts[Number(btn.getAttribute('data-edit'))];
        if (post) showEditor(post);
      });
    });

    B8.qsa('[data-del]', host).forEach(function (btn) {
      B8.on(btn, 'click', function () {
        var post = state.posts[Number(btn.getAttribute('data-del'))];
        if (!post) return;
        B8.confirm('删除《' + post.title + '》？\n' +
          '数据库里删掉就没了；同 slug 的静态 md 还在的话，列表会回落到那一版。', {
          title: '删除文章', okText: '删除', danger: true
        }).then(function (ok) {
          if (!ok) return;
          btn.disabled = true;
          B8.sb.rpc('b8_post_delete', { p_token: B8.auth.token(), p_slug: post.slug })
            .then(function () {
              B8.toast('已删除');
              return afterWrite();
            })
            .then(function (fresh) {
              if (fresh) renderPostList(fresh);
            })
            .catch(function (err) {
              btn.disabled = false;
              B8.toast('删除失败：' + errText(err));
            });
        });
      });
    });
  }

  function hideEditor() {
    var ed = $('adm-post-editor');
    var list = $('adm-post-list');
    if (ed) { ed.hidden = true; ed.innerHTML = ''; }
    if (list) list.hidden = false;
  }

  function showEditor(post) {
    var ed = $('adm-post-editor');
    var list = $('adm-post-list');
    if (!ed) return;

    var isNew = !post;
    var p = post || {
      slug: '', cat: 'news', title: '', date: today(),
      excerpt: '', byline: '', body: ''
    };
    var cats = (B8.content && B8.content.cats) ? B8.content.cats() : {};
    var opts = '';
    var known = false;
    Object.keys(cats).forEach(function (key) {
      if (key === p.cat) known = true;
      opts += '<option value="' + B8.esc(key) + '"' + (key === p.cat ? ' selected' : '') + '>' +
        B8.esc(cats[key].name) + '</option>';
    });
    // 数据库里出现过、但 categories 里没登记的栏目，也要能显示，不能静默改成 news
    if (!known && p.cat) {
      opts = '<option value="' + B8.esc(p.cat) + '" selected>' + B8.esc(p.cat) + '</option>' + opts;
    }

    ed.innerHTML =
      '<h3 style="font-size:1.05rem;margin-top:4px">' +
        (isNew ? '新建文章' : '编辑：' + B8.esc(p.slug)) + '</h3>' +
      '<form id="adm-ed-form" novalidate style="margin-top:12px">' +
        '<div class="admin-row">' +
          '<div class="field">' +
            '<label for="adm-ed-slug">slug（英文小写、数字、连字符）</label>' +
            '<input class="input mono" id="adm-ed-slug" value="' + B8.esc(p.slug) + '"' +
              (isNew ? '' : ' readonly') + '>' +
          '</div>' +
          '<div class="field">' +
            '<label for="adm-ed-cat">栏目</label>' +
            '<select class="input" id="adm-ed-cat">' + opts + '</select>' +
          '</div>' +
        '</div>' +
        '<div class="field" style="margin-top:14px">' +
          '<label for="adm-ed-title">标题</label>' +
          '<input class="input" id="adm-ed-title" value="' + B8.esc(p.title) + '">' +
        '</div>' +
        '<div class="admin-row" style="margin-top:14px">' +
          '<div class="field">' +
            '<label for="adm-ed-date">日期</label>' +
            '<input class="input" id="adm-ed-date" type="date" value="' +
              B8.esc(String(p.date || '').slice(0, 10)) + '">' +
          '</div>' +
          '<div class="field">' +
            '<label for="adm-ed-byline">署名</label>' +
            '<input class="input" id="adm-ed-byline" value="' + B8.esc(p.byline || '') + '">' +
          '</div>' +
        '</div>' +
        '<div class="field" style="margin-top:14px">' +
          '<label for="adm-ed-excerpt">摘要（列表里显示两行）</label>' +
          '<input class="input" id="adm-ed-excerpt" value="' + B8.esc(p.excerpt || '') + '">' +
        '</div>' +
        '<div class="field" style="margin-top:14px">' +
          '<label for="adm-ed-body">正文（可以是 HTML）</label>' +
          '<textarea class="textarea mono" id="adm-ed-body" rows="12"' +
            ' style="font-size:13.5px">' + B8.esc(p.body || '') + '</textarea>' +
        '</div>' +
        '<div class="form-foot" style="margin-top:16px">' +
          '<span class="form-status" id="adm-ed-status"></span>' +
          '<div class="chip-row">' +
            '<button class="btn ghost sm" type="button" id="adm-ed-cancel">收起</button>' +
            '<button class="btn sm" type="submit" id="adm-ed-save">保存</button>' +
          '</div>' +
        '</div>' +
      '</form>';

    ed.hidden = false;
    if (list) list.hidden = true;
    if (ed.scrollIntoView) ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    B8.on($('adm-ed-cancel'), 'click', hideEditor);

    B8.on($('adm-ed-form'), 'submit', function (e) {
      e.preventDefault();

      var status = $('adm-ed-status');
      var slug = B8.trim($('adm-ed-slug').value);
      var title = B8.trim($('adm-ed-title').value);

      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        setStatus(status, 'slug 只能用英文小写、数字和连字符', 'err');
        $('adm-ed-slug').focus();
        return;
      }
      if (!title) {
        setStatus(status, '标题不能为空', 'err');
        $('adm-ed-title').focus();
        return;
      }

      var payload = {
        slug: slug,
        cat: $('adm-ed-cat').value,
        title: title,
        // 空日期给 null：服务端 (p_post->>'date')::date 拿到 NULL 会回落 current_date
        date: $('adm-ed-date').value || null,
        excerpt: B8.trim($('adm-ed-excerpt').value, 120),
        byline: B8.trim($('adm-ed-byline').value, 40),
        body: $('adm-ed-body').value,
        published: true
      };

      var saveBtn = $('adm-ed-save');
      if (saveBtn) saveBtn.disabled = true;
      setStatus(status, '保存中…');

      B8.sb.rpc('b8_post_save', { p_token: B8.auth.token(), p_post: payload })
        .then(function (res) {
          if (!res || !res.ok) throw new Error('服务端没有确认写入');
          B8.toast('文章已保存');
          hideEditor();
          return afterWrite();
        })
        .then(function (fresh) {
          if (fresh) renderPostList(fresh);
        })
        .catch(function (err) {
          if (saveBtn) saveBtn.disabled = false;
          setStatus(status, '保存失败：' + errText(err), 'err');
        });
    });
  }

  /* ---------- B2. 留言 ---------- */

  function loadGuestTab() {
    var body = $('adm-body');
    if (!body) return;

    body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'gap:12px;flex-wrap:wrap">' +
        '<p class="modal-note">最近 50 条留言' +
          (B8.auth.isSuper() ? '，可以改正文、隐藏或删除。' : '，可以删除。') + '</p>' +
        '<button class="btn ghost sm" type="button" id="adm-gb-reload">刷新</button>' +
      '</div>' +
      '<div id="adm-gb-list" style="margin-top:4px">' + loadingHtml('正在读留言…') + '</div>' +
      (B8.auth.isSuper()
        ? '<p class="modal-note" style="margin-top:16px">「隐藏」只改数据库里的 hidden；' +
          '公开查询只放未隐藏的行，所以隐藏后这条在本列表里也会消失。</p>'
        : '');

    B8.on($('adm-gb-reload'), 'click', function () { refreshGuest(false); });
    refreshGuest(false);
  }

  function refreshGuest(silent) {
    var host = $('adm-gb-list');
    if (!host) return Promise.resolve();
    var seq = state.seq;

    if (!B8.sb || !B8.sb.ready) {
      host.innerHTML = failHtml('数据库未配置：', new Error('先填 assets/site-config.js'));
      return Promise.resolve();
    }
    if (!silent) host.innerHTML = loadingHtml('正在读留言…');

    return B8.sb.select('b8_guestbook', 'select=*&order=created_at.desc&limit=50')
      .then(function (rows) {
        if (seq !== state.seq || !$('adm-gb-list')) return;
        state.gb = Array.isArray(rows) ? rows : [];
        renderGuest();
      })
      .catch(function (err) {
        if (seq !== state.seq) return;
        var h = $('adm-gb-list');
        if (h) h.innerHTML = failHtml('留言没读到：', err);
      });
  }

  function gbRow(id) {
    for (var i = 0; i < state.gb.length; i++) {
      if (Number(state.gb[i].id) === Number(id)) return state.gb[i];
    }
    return null;
  }

  function renderGuest() {
    var host = $('adm-gb-list');
    if (!host) return;

    if (!state.gb.length) {
      host.innerHTML = emptyHtml('还没有留言。');
      return;
    }

    var superUser = B8.auth.isSuper();
    var html = '';

    state.gb.forEach(function (row) {
      var id = Number(row.id);
      var editing = id === Number(state.editing);

      html += '<article class="gb-item" data-id="' + id + '">' +
        '<div class="gb-head">' +
          '<span class="gb-nick">' + B8.esc(row.nick || '路过的人') + '</span>' +
          '<span class="gb-time">' + B8.esc(row.created_at ? B8.dateTime(row.created_at) : '') + '</span>' +
          '<span class="tag plain">#' + id + '</span>' +
          (row.edited_at ? '<span class="tag plain">已编辑</span>' : '') +
        '</div>';

      if (editing) {
        html +=
          '<div class="field" style="margin-top:8px">' +
            '<textarea class="textarea" id="adm-gb-draft" rows="4" maxlength="800"' +
              ' style="font-size:14px">' + B8.esc(state.draft) + '</textarea>' +
          '</div>' +
          '<div class="chip-row" style="margin-top:8px">' +
            '<span class="form-status" id="adm-gb-status" style="flex:1"></span>' +
            '<button class="btn ghost sm" type="button" data-gb-cancel>取消</button>' +
            '<button class="btn sm" type="button" data-gb-save>保存正文</button>' +
          '</div>';
      } else {
        html += '<p class="gb-body">' + B8.nl2br(row.body) + '</p>' +
          '<div class="chip-row" style="margin-top:8px">' +
            (superUser
              ? '<button class="btn ghost sm" type="button" data-gb-edit>编辑</button>' +
                '<button class="btn ghost sm" type="button" data-gb-hide>隐藏</button>'
              : '') +
            '<button class="btn ghost sm" type="button" data-gb-del>删除</button>' +
          '</div>';
      }

      html += '</article>';
    });

    host.innerHTML = html;

    B8.qsa('.gb-item', host).forEach(function (item) {
      var id = Number(item.getAttribute('data-id'));

      var ta = B8.qs('#adm-gb-draft', item);
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
        B8.on(ta, 'input', function () { state.draft = ta.value; });
      }

      B8.on(B8.qs('[data-gb-edit]', item), 'click', function () {
        var row = gbRow(id);
        state.editing = id;
        state.draft = row ? (row.body || '') : '';
        renderGuest();
      });

      B8.on(B8.qs('[data-gb-cancel]', item), 'click', function () {
        state.editing = 0;
        state.draft = '';
        renderGuest();
      });

      B8.on(B8.qs('[data-gb-save]', item), 'click', function () {
        var btn = B8.qs('[data-gb-save]', item);
        var box = $('adm-gb-draft');
        var body = B8.trim(box ? box.value : '');
        var st = $('adm-gb-status');

        if (!body) { setStatus(st, '内容不能为空', 'err'); return; }
        if (body.length > 800) { setStatus(st, '太长了，800 字以内', 'err'); return; }

        if (btn) btn.disabled = true;
        setStatus(st, '保存中…');

        B8.sb.rpc('b8_guest_edit', {
          p_token: B8.auth.token(), p_id: id, p_body: body
        }).then(function () {
          B8.toast('留言已改');
          state.editing = 0;
          state.draft = '';
          return refreshGuest(true);
        }).catch(function (err) {
          if (btn) btn.disabled = false;
          setStatus($('adm-gb-status'), '保存失败：' + errText(err), 'err');
        });
      });

      B8.on(B8.qs('[data-gb-hide]', item), 'click', function () {
        var btn = B8.qs('[data-gb-hide]', item);
        B8.confirm('隐藏这条留言？\n隐藏后公开的留言板里就看不到了；' +
          '前端没有恢复入口，只能去数据库改 hidden。', {
          title: '隐藏留言', okText: '隐藏', danger: true
        }).then(function (ok) {
          if (!ok) return;
          if (btn) btn.disabled = true;
          B8.sb.rpc('b8_guest_hide', {
            p_token: B8.auth.token(), p_id: id, p_hidden: true
          }).then(function () {
            B8.toast('已隐藏');
            return refreshGuest(true);
          }).catch(function (err) {
            if (btn) btn.disabled = false;
            B8.toast('隐藏失败：' + errText(err));
          });
        });
      });

      B8.on(B8.qs('[data-gb-del]', item), 'click', function () {
        var btn = B8.qs('[data-gb-del]', item);
        B8.confirm('删除这条留言？删了就找不回来了。', {
          title: '删除留言', okText: '删除', danger: true
        }).then(function (ok) {
          if (!ok) return;
          if (btn) btn.disabled = true;
          B8.sb.rpc('b8_guest_del', { p_token: B8.auth.token(), p_id: id })
            .then(function () {
              B8.toast('已删除');
              return refreshGuest(true);
            })
            .catch(function (err) {
              if (btn) btn.disabled = false;
              B8.toast('删除失败：' + errText(err));
            });
        });
      });
    });
  }

  /* ---------- 表格小件（base.css 里没有通用表格样式） ---------- */

  var TH_STYLE = 'padding:8px 10px;text-align:left;font-family:var(--mono);font-size:10.5px;' +
    'letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-3);' +
    'border-bottom:1px solid var(--line-2);white-space:nowrap';
  var TD_STYLE = 'padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle';

  function th(text) {
    return '<th style="' + TH_STYLE + '">' + B8.esc(text) + '</th>';
  }

  // 传进来的 html 必须已经 esc 过（有些格子要放 .tag 标签，不能整格转义）
  function td(html) {
    return '<td style="' + TD_STYLE + '">' + html + '</td>';
  }

  function tableOpen(minWidth) {
    return '<div style="margin-top:12px;overflow-x:auto">' +
      '<table style="width:100%;min-width:' + minWidth + 'px;border-collapse:collapse;' +
      'font-size:13px">';
  }

  /* ---------- B3. 密钥（仅超管） ---------- */

  function loadKeysTab() {
    var body = $('adm-body');
    if (!body) return;

    if (!B8.auth.isSuper()) {
      body.innerHTML = failHtml('', new Error('这个操作需要超级管理员密钥'));
      return;
    }

    body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'gap:12px;flex-wrap:wrap">' +
        '<p class="modal-note">一人一钥：绑给谁就只认谁。停用后权限立刻失效。</p>' +
        '<button class="btn ghost sm" type="button" id="adm-keys-reload">刷新</button>' +
      '</div>' +
      '<div id="adm-key-list"></div>';

    B8.on($('adm-keys-reload'), 'click', function () { refreshKeys(false); });
    refreshKeys(false);
  }

  function refreshKeys(silent) {
    var host = $('adm-key-list');
    if (!host) return Promise.resolve();
    var seq = state.seq;

    if (!B8.sb || !B8.sb.ready) {
      host.innerHTML = failHtml('数据库未配置：', new Error('先填 assets/site-config.js'));
      return Promise.resolve();
    }
    if (!silent) host.innerHTML = loadingHtml('正在读密钥…');

    return B8.sb.rpc('b8_super_keys', { p_token: B8.auth.token() })
      .then(function (rows) {
        if (seq !== state.seq || !$('adm-key-list')) return;
        state.keys = Array.isArray(rows) ? rows : [];
        renderKeys();
      })
      .catch(function (err) {
        if (seq !== state.seq) return;
        var h = $('adm-key-list');
        if (h) h.innerHTML = failHtml('密钥没读到：', err);
      });
  }

  function renderKeys() {
    var host = $('adm-key-list');
    if (!host) return;

    if (!state.keys.length) {
      host.innerHTML = emptyHtml('没有可管的密钥。');
      return;
    }

    var html = tableOpen(860) +
      '<thead><tr>' +
        th('编号') + th('类型') + th('备注') + th('绑给谁') +
        th('最后使用') + th('次数') + th('状态') + th('操作') +
      '</tr></thead><tbody>';

    for (var i = 0; i < state.keys.length; i++) {
      var k = state.keys[i];
      var isSuperKey = k.kind === 'super';
      var bound = k.bound_no ? (k.bound_name || k.bound_no) : '未使用';

      html += '<tr>' +
        td('<span class="mono">#' + Number(k.id) + '</span>') +
        td(isSuperKey
          ? '<span class="tag">超管</span>'
          : '<span class="tag jade">管理员</span>') +
        td(B8.esc(k.label || '—')) +
        td(B8.esc(bound)) +
        td(B8.esc(k.last_used ? B8.dateTime(k.last_used) : '—')) +
        td(String(Number(k.use_count) || 0)) +
        td(k.active
          ? '<span class="tag jade">启用</span>'
          : '<span class="tag plain">停用</span>') +
        td('<div class="chip-row">' +
          '<button class="btn ghost sm" type="button" data-key-toggle="' + i + '">' +
            (k.active ? '停用' : '启用') + '</button>' +
          '<button class="btn ghost sm" type="button" data-key-unbind="' + i + '"' +
            (k.bound_no ? '' : ' disabled') + '>解绑</button>' +
        '</div>') +
      '</tr>';
    }
    html += '</tbody></table></div>';
    host.innerHTML = html;

    B8.qsa('[data-key-toggle]', host).forEach(function (btn) {
      B8.on(btn, 'click', function () {
        var k = state.keys[Number(btn.getAttribute('data-key-toggle'))];
        if (!k) return;
        var next = !k.active;              // 现在启用 → 点下去是停用

        function doToggle() {
          btn.disabled = true;
          B8.sb.rpc('b8_super_key_toggle', {
            p_token: B8.auth.token(),
            p_id: Number(k.id),
            p_active: next
          }).then(function () {
            B8.toast(next ? '已启用' : '已停用');
            return refreshKeys(true);
          }).catch(function (err) {
            btn.disabled = false;
            B8.toast('操作失败：' + errText(err));
          });
        }

        if (!next) {
          B8.confirm('停用「' + (k.label || ('#' + k.id)) + '」？\n' +
            '停用后这个人的管理员权限立刻失效，正在用的后台会话也会被踢掉。\n' +
            '（如果停用的是你自己手里这把，你会立刻掉线。）', {
            title: '停用密钥', okText: '停用', danger: true
          }).then(function (ok) { if (ok) doToggle(); });
        } else {
          doToggle();
        }
      });
    });

    B8.qsa('[data-key-unbind]', host).forEach(function (btn) {
      B8.on(btn, 'click', function () {
        var k = state.keys[Number(btn.getAttribute('data-key-unbind'))];
        if (!k || !k.bound_no) return;
        B8.confirm('解绑「' + (k.label || ('#' + k.id)) + '」？\n' +
          '解绑后这把钥匙可以绑给别人，现在用它提权的会话立刻失效。', {
          title: '解绑密钥', okText: '解绑', danger: true
        }).then(function (ok) {
          if (!ok) return;
          btn.disabled = true;
          B8.sb.rpc('b8_super_key_unbind', {
            p_token: B8.auth.token(), p_id: Number(k.id)
          }).then(function () {
            B8.toast('已解绑');
            return refreshKeys(true);
          }).catch(function (err) {
            btn.disabled = false;
            B8.toast('解绑失败：' + errText(err));
          });
        });
      });
    });
  }

  /* ---------- B4. 成员（仅超管） ---------- */

  function loadMembersTab() {
    var body = $('adm-body');
    if (!body) return;

    if (!B8.auth.isSuper()) {
      body.innerHTML = failHtml('', new Error('这个操作需要超级管理员密钥'));
      return;
    }

    body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'gap:12px;flex-wrap:wrap">' +
        '<p class="modal-note">花名册里的学号。重置密码、停用账号都会踢掉对方当前的登录。</p>' +
        '<button class="btn ghost sm" type="button" id="adm-members-reload">刷新</button>' +
      '</div>' +
      '<div id="adm-member-list"></div>';

    B8.on($('adm-members-reload'), 'click', function () { refreshMembers(false); });
    refreshMembers(false);
  }

  function refreshMembers(silent) {
    var host = $('adm-member-list');
    if (!host) return Promise.resolve();
    var seq = state.seq;

    if (!B8.sb || !B8.sb.ready) {
      host.innerHTML = failHtml('数据库未配置：', new Error('先填 assets/site-config.js'));
      return Promise.resolve();
    }
    if (!silent) host.innerHTML = loadingHtml('正在读成员…');

    return B8.sb.rpc('b8_super_members', { p_token: B8.auth.token() })
      .then(function (rows) {
        if (seq !== state.seq || !$('adm-member-list')) return;
        state.members = Array.isArray(rows) ? rows : [];
        renderMembers();
      })
      .catch(function (err) {
        if (seq !== state.seq) return;
        var h = $('adm-member-list');
        if (h) h.innerHTML = failHtml('成员没读到：', err);
      });
  }

  function renderMembers() {
    var host = $('adm-member-list');
    if (!host) return;

    if (!state.members.length) {
      host.innerHTML = emptyHtml('花名册是空的。');
      return;
    }

    var html = tableOpen(760) +
      '<thead><tr>' +
        th('学号') + th('姓名') + th('已设密码') + th('认领时间') +
        th('最后登录') + th('操作') +
      '</tr></thead><tbody>';

    for (var i = 0; i < state.members.length; i++) {
      var m = state.members[i];
      html += '<tr>' +
        td('<span class="mono">' + B8.esc(m.student_no) + '</span>') +
        td(B8.esc(m.name || '—') +
          (m.active ? '' : ' <span class="tag plain">已停用</span>')) +
        td(m.has_pass
          ? '<span class="tag jade">已设</span>'
          : '<span class="tag plain">未设</span>') +
        td(B8.esc(m.claimed_at ? B8.dateTime(m.claimed_at) : '—')) +
        td(B8.esc(m.last_login ? B8.dateTime(m.last_login) : '—')) +
        td('<div class="chip-row">' +
          '<button class="btn ghost sm" type="button" data-mem-pass="' + i + '">重置密码</button>' +
          '<button class="btn ghost sm" type="button" data-mem-toggle="' + i + '">' +
            (m.active ? '停用账号' : '启用账号') + '</button>' +
        '</div>') +
      '</tr>';
    }
    html += '</tbody></table></div>';
    host.innerHTML = html;

    B8.qsa('[data-mem-pass]', host).forEach(function (btn) {
      B8.on(btn, 'click', function () {
        var m = state.members[Number(btn.getAttribute('data-mem-pass'))];
        if (!m) return;

        openDialog({
          title: '重置密码',
          note: '给 <strong>' + B8.esc(m.name || '这个学号') + '</strong>（' +
            B8.esc(m.student_no) + '）设一个新密码，至少 6 位。' +
            '<br>重置后这个人所有登录都会失效，下次用新密码进来。',
          label: '新密码',
          type: 'password',
          placeholder: '至少 6 位',
          confirmText: '重置',
          validate: function (v) {
            return String(v || '').length < 6 ? '新密码至少 6 位' : '';
          },
          onSubmit: function (v) {
            return B8.sb.rpc('b8_super_reset_pass', {
              p_token: B8.auth.token(),
              p_no: m.student_no,
              p_new_pass: v
            });
          },
          onDone: function () {
            B8.toast('密码已重置');
            refreshMembers(true);
          }
        });
      });
    });

    B8.qsa('[data-mem-toggle]', host).forEach(function (btn) {
      B8.on(btn, 'click', function () {
        var m = state.members[Number(btn.getAttribute('data-mem-toggle'))];
        if (!m) return;
        var next = !m.active;

        function doToggle() {
          btn.disabled = true;
          B8.sb.rpc('b8_super_member_toggle', {
            p_token: B8.auth.token(),
            p_no: m.student_no,
            p_active: next
          }).then(function () {
            B8.toast(next ? '账号已启用' : '账号已停用');
            return refreshMembers(true);
          }).catch(function (err) {
            btn.disabled = false;
            B8.toast('操作失败：' + errText(err));
          });
        }

        if (!next) {
          B8.confirm('停用 ' + (m.name || m.student_no) + ' 的账号？\n' +
            '停用后这个账号立刻不能登录，正在用的会话也会失效。', {
            title: '停用账号', okText: '停用', danger: true
          }).then(function (ok) { if (ok) doToggle(); });
        } else {
          doToggle();
        }
      });
    });
  }

  /* ---------- 启动 ---------- */

  function boot() {
    if (!elOpen) return;

    // index.html 里的入口按钮默认 hidden，脚本接上了才露出来
    elOpen.hidden = false;
    elOpen.title = '管理后台 ' + VERSION + ' · ' + BUILD;
    B8.on(elOpen, 'click', onOpenClick);

    // auth.js 启动时要拿缓存令牌去服务端核一次，核完才算"登录状态确定"
    state.authSettled = false;
    if (typeof B8.auth.ready === 'function') {
      B8.auth.ready(function () {
        state.authSettled = true;
        syncEntry();
      });
    } else {
      state.authSettled = true;
    }

    document.addEventListener('b8:auth', syncEntry);
    syncEntry();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
