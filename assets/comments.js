/* ============================================================
   文章评论
   ------------------------------------------------------------
   留言板是「对全班说的话」，这里是「对某一篇说的话」。
   免登录也能评（可以署名），登录了会把学号一起记上，方便以后认人。
   管理员能就地删。
   ============================================================ */
(function () {
  'use strict';

  var B8 = window.B8;
  if (!B8) return;

  var elList = B8.qs('#comment-list');
  var elForm = B8.qs('#comment-form');
  var elName = B8.qs('#cm-name');
  var elBody = B8.qs('#cm-body');
  var elTrap = B8.qs('#cm-trap');
  var elSubmit = B8.qs('#cm-submit');
  var elStatus = B8.qs('#cm-status');
  var elCount = B8.qs('#comment-count');

  var slug = (function () {
    var m = (location.search || '').match(/[?&]slug=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  })();

  var count = 0;
  var trapTouched = false;

  function setStatus(msg, kind) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  function itemNode(row) {
    var wrap = document.createElement('div');
    wrap.className = 'comment';
    wrap.setAttribute('data-id', row.id);

    var head = document.createElement('div');
    head.className = 'comment-head';
    var name = document.createElement('span');
    name.className = 'comment-name';
    name.textContent = row.name || '路过的人';
    head.appendChild(name);

    var time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = B8.ago(row.created_at);
    head.appendChild(time);

    if (B8.auth && B8.auth.isAdmin()) {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'admin-btn comment-del';
      del.textContent = '删除';
      del.setAttribute('data-del', row.id);
      head.appendChild(del);
    }

    wrap.appendChild(head);

    var body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = row.body;
    wrap.appendChild(body);

    return wrap;
  }

  function render(rows) {
    if (!elList) return;
    elList.innerHTML = '';
    rows.forEach(function (r) { elList.appendChild(itemNode(r)); });

    count = rows.length;
    if (elCount) elCount.textContent = String(count);

    if (!rows.length) {
      var empty = document.createElement('p');
      empty.className = 'comment-empty';
      empty.textContent = '还没有人说话。第一篇评论可以现在写。';
      elList.appendChild(empty);
    }
  }

  function load() {
    if (!elList) return;
    if (!B8.sb || !B8.sb.ready) {
      elList.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'comment-empty';
      p.textContent = '评论区还没接数据库。';
      elList.appendChild(p);
      if (elForm) elForm.hidden = true;
      return;
    }
    if (!slug) return;

    B8.sb.rpc('b8_comment_list', { p_slug: slug })
      .then(function (rows) { render(Array.isArray(rows) ? rows : []); })
      .catch(function (err) {
        if (elList) {
          elList.innerHTML = '';
          var q = document.createElement('p');
          q.className = 'comment-empty';
          q.textContent = '评论没读出来：' + (err && err.message ? err.message : '网络异常');
          elList.appendChild(q);
        }
      });
  }

  function submit(e) {
    e.preventDefault();
    if (!slug) return;

    var body = B8.trim(elBody && elBody.value, 600);
    var name = B8.trim(elName && elName.value, 16);
    if (!body) { setStatus('写点什么再发吧', 'err'); if (elBody) elBody.focus(); return; }

    var trap = '';
    if (elTrap) {
      if (elTrap.value && trapTouched) trap = elTrap.value;
      elTrap.value = '';
    }

    if (!B8.sb || !B8.sb.ready) { setStatus('评论区还没接数据库', 'err'); return; }

    if (elSubmit) { elSubmit.disabled = true; elSubmit.textContent = '发送中…'; }
    setStatus('');

    B8.sb.rpc('b8_comment_add', {
      p_slug: slug,
      p_name: name,
      p_body: body,
      p_trap: trap,
      p_token: B8.auth && B8.auth.isLogged() ? B8.auth.token() : ''
    }).then(function (res) {
      if (!res || !res.ok) throw new Error('服务端没有确认写入');
      if (elBody) elBody.value = '';
      setStatus('发出去了。', 'ok');
      B8.toast('评论已发布');
      load();
    }).catch(function (err) {
      setStatus('没发出去：' + (err && err.message ? err.message : '网络异常'), 'err');
    }).then(function () {
      if (elSubmit) { elSubmit.disabled = false; elSubmit.textContent = '发上去'; }
    });
  }

  function onListClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('.comment-del') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-del');
    B8.confirm('删掉这条评论？', {
      title: '删除评论', okText: '删除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      B8.sb.rpc('b8_comment_del', { p_token: B8.auth.token(), p_id: Number(id) })
        .then(function () { B8.toast('已删除'); load(); })
        .catch(function (err) {
          btn.disabled = false;
          B8.toast('删不掉：' + (err && err.message ? err.message : '网络异常'));
        });
    });
  }

  function boot() {
    if (!elForm) return;
    B8.on(elForm, 'submit', submit);
    B8.on(elList, 'click', onListClick);
    B8.on(elTrap, 'input', function () { trapTouched = true; });
    B8.on(elTrap, 'change', function () { trapTouched = true; });

    // 登录后署名框默认填真名
    if (B8.auth) {
      B8.auth.ready(function () {
        if (elName && !elName.value && B8.auth.nick()) elName.value = B8.auth.nick();
      });
      document.addEventListener('b8:auth', function () {
        if (elName && !elName.value && B8.auth.nick()) elName.value = B8.auth.nick();
        load();   // 提权后要把"删除"按钮画出来
      });
    }

    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
