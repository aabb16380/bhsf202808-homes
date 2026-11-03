/* ============================================================
   留言板（公开、免登录）
   ------------------------------------------------------------
   写操作走 RPC b8_guest_add，服务端做长度/频率/重复校验。
   失败时把服务端的中文 message 原样显示出来——"发送失败"
   这三个字对用户没有任何帮助。
   ============================================================ */
(function () {
  'use strict';

  var B8 = window.B8;
  if (!B8) return;

  var PAGE = 20;
  var state = { offset: 0, loading: false, done: false, count: 0 };

  var elList = B8.qs('#gb-list');
  var elForm = B8.qs('#gb-form');
  var elNick = B8.qs('#gb-nick');
  var elBody = B8.qs('#gb-body');
  var elTrap = B8.qs('#gb-website');
  var elSubmit = B8.qs('#gb-submit');
  var elStatus = B8.qs('#gb-status');
  var elMore = B8.qs('#gb-more');
  var elEmpty = B8.qs('#gb-empty');
  var trapTouched = false;

  function setStatus(msg, kind) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  function itemHtml(row) {
    return (
      '<article class="gb-item" data-id="' + Number(row.id) + '">' +
        '<div class="gb-head">' +
          '<span class="gb-nick">' + B8.esc(row.nick || '路过的人') + '</span>' +
          '<span class="gb-time">' + B8.esc(B8.ago(row.created_at)) + '</span>' +
          (B8.auth && B8.auth.isAdmin()
            ? '<button class="admin-btn gb-del" type="button" data-id="' + Number(row.id) + '">删除</button>'
            : '') +
        '</div>' +
        '<p class="gb-body">' + B8.nl2br(row.body) + '</p>' +
      '</article>'
    );
  }

  function append(rows, prepend) {
    if (!rows || !rows.length) return;
    var html = rows.map(itemHtml).join('');
    if (prepend) {
      elList.insertAdjacentHTML('afterbegin', html);
    } else {
      elList.insertAdjacentHTML('beforeend', html);
    }
    state.count += rows.length;
    if (elEmpty) elEmpty.hidden = state.count > 0;
  }

  function loadMore() {
    if (state.loading || state.done) return;
    if (!B8.sb || !B8.sb.ready) {
      if (elEmpty) {
        elEmpty.hidden = false;
        elEmpty.textContent = '留言板还没接数据库：先执行 supabase/schema.sql，再把 URL 和 anon key 填进 assets/site-config.js。';
      }
      setStatus('数据库未接入，暂时只能看不能写。');
      return;
    }

    state.loading = true;
    if (elMore) elMore.disabled = true;

    B8.sb
      .select(
        'b8_guestbook',
        'select=id,nick,body,created_at&hidden=eq.false&order=created_at.desc' +
          '&limit=' + PAGE + '&offset=' + state.offset
      )
      .then(function (rows) {
        append(rows || [], false);
        state.offset += (rows || []).length;
        if (!rows || rows.length < PAGE) state.done = true;
        if (elMore) elMore.hidden = state.done;
        if (state.count === 0 && elEmpty) {
          elEmpty.hidden = false;
          elEmpty.textContent = '还没有人留言，来写第一条。';
        }
      })
      .catch(function (err) {
        setStatus('留言没读到：' + (err && err.message ? err.message : '网络异常'), 'err');
        if (state.count === 0 && elEmpty) {
          elEmpty.hidden = false;
          elEmpty.textContent = '留言暂时读不到：' + (err && err.message ? err.message : '网络异常');
        }
      })
      .then(function () {
        state.loading = false;
        if (elMore) elMore.disabled = false;
      });
  }

  /* ---------- 提交 ---------- */
  function onSubmit(e) {
    e.preventDefault();

    var nick = B8.trim(elNick && elNick.value, 16);
    var body = B8.trim(elBody && elBody.value, 800);

    if (body.length < 1) {
      setStatus('写点什么再发吧', 'err');
      if (elBody) elBody.focus();
      return;
    }
    if (body.length > 800) {
      setStatus('太长了，800 字以内', 'err');
      return;
    }
    if (!B8.sb || !B8.sb.ready) {
      setStatus('留言板还没接数据库，先看 supabase/schema.sql', 'err');
      return;
    }

    // 蜜罐被自动填充：清空后继续，不静默失败
    var trap = '';
    if (elTrap) {
      if (elTrap.value && trapTouched) trap = elTrap.value;
      elTrap.value = '';
    }

    if (elSubmit) { elSubmit.disabled = true; elSubmit.textContent = '发送中…'; }
    setStatus('');

    B8.sb
      .rpc('b8_guest_add', { p_nick: nick, p_body: body, p_trap: trap })
      .then(function (res) {
        if (!res || !res.ok) throw new Error('服务端没有确认写入');
        append([{ id: res.id, nick: nick || '路过的人', body: body, created_at: new Date().toISOString() }], true);
        if (elBody) elBody.value = '';
        setStatus('发出去了，谢谢你。', 'ok');
        B8.toast('留言已发布');
      })
      .catch(function (err) {
        setStatus('没发出去：' + (err && err.message ? err.message : '网络异常'), 'err');
      })
      .then(function () {
        if (elSubmit) { elSubmit.disabled = false; elSubmit.textContent = '发上去'; }
      });
  }

  /* ---------- 管理员删留言 ---------- */
  function onListClick(e) {
    var btn = e.target.closest ? e.target.closest('.gb-del') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    B8.confirm('删除这条留言？删了就找不回来了。', {
      title: '删除留言', okText: '删除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      B8.sb
        .rpc('b8_guest_del', { p_token: B8.auth.token(), p_id: Number(id) })
        .then(function () {
          var node = B8.qs('.gb-item[data-id="' + id + '"]');
          if (node && node.parentNode) node.parentNode.removeChild(node);
          state.count = Math.max(0, state.count - 1);
          B8.toast('已删除');
        })
        .catch(function (err) {
          btn.disabled = false;
          B8.toast('删除失败：' + (err && err.message ? err.message : '网络异常'));
        });
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    if (!elList) return;

    B8.on(elForm, 'submit', onSubmit);
    B8.on(elList, 'click', onListClick);
    B8.on(elMore, 'click', loadMore);
    B8.on(elTrap, 'input', function () { trapTouched = true; });
    B8.on(elTrap, 'change', function () { trapTouched = true; });

    loadMore();

    // 管理员登录后，已有的留言要补上删除按钮
    document.addEventListener('b8:auth', function () {
      if (!B8.auth.isAdmin()) return;
      B8.qsa('.gb-item').forEach(function (node) {
        if (B8.qs('.gb-del', node)) return;
        var head = B8.qs('.gb-head', node);
        if (!head) return;
        var btn = document.createElement('button');
        btn.className = 'admin-btn gb-del';
        btn.type = 'button';
        btn.setAttribute('data-id', node.getAttribute('data-id'));
        btn.textContent = '删除';
        head.appendChild(btn);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
