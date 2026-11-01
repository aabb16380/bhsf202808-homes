/* ============================================================
   八班纪事 · 唯一配置点
   ------------------------------------------------------------
   1. 在 supabase.com 建一个项目（区域选 Singapore），
      SQL Editor 里整段执行 supabase/schema.sql，再执行 supabase/seed.sql
   2. Settings → API，把 Project URL 和 anon public key 填到下面
   两个值留空时：文章走静态版、留言板自动隐藏，站点照常打开。
   ============================================================ */
window.B8_CONFIG = {
  site: {
    name: '八班纪事',
    domain: 'bhsf202808.homes',
    github: 'aabb16380',
    version: 'v1.0'
  },

  supabase: {
    url: '',        // 例：https://abcdefghijkl.supabase.co
    anonKey: ''     // 例：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....
  },

  links: {
    homes: 'https://bhsf202808.homes/',
    fun: 'https://bhsf202808.fun/',
    site: 'https://bhsf202808.site/'
  },

  // 板块开关：改完推上去就生效
  features: {
    guestbook: true,
    admin: true
  }
};
