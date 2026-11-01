/* ============================================================
   内容层：静态 posts.js + Supabase b8_posts 运行时合并
   ------------------------------------------------------------
   取舍：数据库是"覆盖层"而不是"唯一来源"。
   Supabase 没配、挂了、断网，都只是少一次合并，页面照常出内容。
   缓存 5 分钟，避免每次翻页都打一次网络。
   ============================================================ */
(function () {
  'use strict';

  var B8 = window.B8 = window.B8 || {};
  var CACHE_KEY = 'b8.posts.cache';
  var TTL = 5 * 60 * 1000;

  var state = { data: null, source: 'static', error: null };
  var pending = null;

  function statics() {
    return (window.B8_POSTS || []).slice();
  }

  function byDateDesc(a, b) {
    if (a.date === b.date) return (a.order || 100) - (b.order || 100);
    return a.date < b.date ? 1 : -1;
  }

  function merge(dbRows, dropped) {
    var map = {};
    var list = [];

    var dead = {};
    (dropped || []).forEach(function (d) { dead[d.slug] = true; });

    statics().forEach(function (p) {
      if (dead[p.slug]) return;   // 后台删过的，别再合并回来
      map[p.slug] = p;
      list.push(p);
    });

    (dbRows || []).forEach(function (row) {
      var old = map[row.slug];
      var item = {
        slug: row.slug,
        cat: row.cat || 'news',
        title: row.title || row.slug,
        date: String(row.date || '').slice(0, 10),
        excerpt: row.excerpt || '',
        byline: row.byline || '',
        views: Number(row.views || 0),
        order: Number(row.sort_order || 100),
        body: row.body || (old && old.body) || '',
        words: (row.body || (old && old.body) || '').length,
        from: 'db'
      };
      if (old) {
        var i = list.indexOf(old);
        if (i >= 0) list[i] = item;
      } else {
        list.push(item);
      }
      map[row.slug] = item;
    });

    list.sort(byDateDesc);
    return list.filter(function (p) { return p.published !== false; });
  }

  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.t || Date.now() - obj.t > TTL) return null;
      return obj.data;
    } catch (e) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: data }));
    } catch (e) {}
  }

  var content = B8.content = {
    source: function () { return state.source; },
    error: function () { return state.error; }
  };

  content.cats = function () {
    return window.B8_CATS || {
      news: { name: '新鲜事', desc: '' },
      activity: { name: '活动', desc: '' },
      notice: { name: '通知', desc: '' }
    };
  };

  /** 加载全部文章（含正文）。失败就回落静态版。 */
  content.load = function (force) {
    if (state.data && !force) return Promise.resolve(state.data);
    if (pending && !force) return pending;

    if (!force) {
      var cached = readCache();
      if (cached) {
        state.data = cached;
        state.source = 'cache';
        return Promise.resolve(cached);
      }
    }

    var fallback = function (err) {
      state.error = err || null;
      state.source = 'static';
      state.data = merge([], []);
      pending = null;
      return state.data;
    };

    if (!B8.sb || !B8.sb.ready) return Promise.resolve(fallback(null));

    pending = Promise.all([
      B8.sb.select('b8_posts', 'select=slug,cat,title,date,excerpt,byline,body,views,sort_order,published&order=date.desc&limit=300'),
      B8.sb.select('b8_post_dropped', 'select=slug').catch(function () { return []; })
    ])
      .then(function (all) {
        var rows = all[0] || [];
        var dead = all[1] || [];
        state.source = 'db';
        state.error = null;
        state.data = merge(rows, dead);
        writeCache(state.data);
        pending = null;
        return state.data;
      })
      .catch(function (err) {
        if (window.console) console.warn('[content] 数据库没读到，用静态版：', err && err.message);
        return fallback(err);
      });

    return pending;
  };

  /** 单篇：优先数据库，其次静态 */
  content.one = function (slug) {
    return content.load().then(function (list) {
      var hit = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].slug === slug) { hit = list[i]; break; }
      }
      if (hit && hit.body) return hit;

      if (B8.sb && B8.sb.ready) {
        return B8.sb.select('b8_posts', 'select=*&slug=eq.' + encodeURIComponent(slug) + '&limit=1')
          .then(function (rows) {
            if (rows && rows[0]) {
              var row = rows[0];
              return {
                slug: row.slug,
                cat: row.cat,
                title: row.title,
                date: String(row.date || '').slice(0, 10),
                excerpt: row.excerpt || '',
                byline: row.byline || '',
                views: Number(row.views || 0),
                body: row.body || '',
                from: 'db'
              };
            }
            return hit;
          })
          .catch(function () { return hit; });
      }
      return hit;
    });
  };

  /** 阅读数 +1：同一会话每篇只算一次，其余时候只读取当前值 */
  content.bumpView = function (post) {
    if (!B8.sb || !B8.sb.ready || !post || !post.slug) return Promise.resolve(post && post.views);

    var seenKey = 'b8.viewed.' + post.slug;
    var seen = false;
    try { seen = sessionStorage.getItem(seenKey) === '1'; } catch (e) {}

    if (seen) {
      return B8.sb
        .select('b8_posts', 'select=views&slug=eq.' + encodeURIComponent(post.slug) + '&limit=1')
        .then(function (rows) { return rows && rows[0] ? Number(rows[0].views) : post.views; })
        .catch(function () { return post.views; });
    }

    try { sessionStorage.setItem(seenKey, '1'); } catch (e) {}

    return B8.sb
      .rpc('b8_bump_views', {
        p_slug: post.slug,
        p_title: post.title || post.slug,
        p_cat: post.cat || 'news',
        p_date: post.date || null,
        p_excerpt: post.excerpt || '',
        p_byline: post.byline || '',
        p_body: post.body || ''
      })
      .then(function (n) { return Number(n); })
      .catch(function () { return post.views; });
  };

  /** 作者：文章正文里可能有 HTML，渲染前统一过一遍（只允许白名单外的标签被剥掉） */
  content.sanitize = function (html) {
    // 内容全部来自班长自己（md 或管理员后台），不做重度过滤，但挡掉脚本与事件属性
    return String(html || '')
      .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*iframe[\s\S]*?<\s*\/\s*iframe\s*>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '');
  };
})();
