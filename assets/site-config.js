/* ============================================================
   八班纪事 · 唯一配置点
   ------------------------------------------------------------
   Supabase 项目：zcfdtfmxtsxacsklqlhe（Singapore · free）
   三站共用这一个库，表名统一 b8_ 前缀。
   用的是新版 publishable key（等价于旧的 anon key，只读权限+过 RLS）。
   ============================================================ */
window.B8_CONFIG = {
  site: {
    name: '八班纪事',
    domain: 'bhsf202808.homes',
    github: 'aabb16380',
    version: 'v2.1'
  },

  supabase: {
    url: 'https://zcfdtfmxtsxacsklqlhe.supabase.co',
    anonKey: 'sb_publishable_kkJAT4lA9KFJGhua2V9gjw_tr-doaVN'
  },

  links: {
    homes: '//bhsf202808.homes/',
    fun: '//bhsf202808.fun/',
    site: '//bhsf202808.site/'
  },

  // 板块开关：改完推上去就生效
  features: {
    guestbook: true,
    admin: true
  }
};
