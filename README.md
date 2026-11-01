# 八班纪事 · bhsf202808.homes

北京四中 2028 届 8 班的公开主页：班级新鲜事、活动记录、留言板。

纯静态，零依赖，零构建。改完文件推上去就生效。

---

## 这个仓库里有什么

```
index.html            首页：首屏 / 新鲜事 / 活动 / 留言板
article.html          文章详情（靠 ?slug= 渲染，同一份模板服务所有文章）
log.html              更新日志
404.html
test/index.html       调试入口：每次访问都带新时间戳，绕过缓存
CNAME                 自定义域名（绑定 GitHub Pages 用）
.nojekyll             必须留着，否则 Pages 会走 Jekyll 处理
robots.txt / sitemap.xml

content/
  categories.json     栏目定义（新鲜事 / 活动 / 通知）
  posts/*.md          文章：front matter + 正文（HTML 或纯文本段落）

scripts/
  build-posts.mjs     md → assets/posts.js + sitemap.xml（含 slug 冲突检查）
  gen-seed.mjs        生成班级口令/管理员密钥 + supabase/seed.sql
  lib/posts.mjs       上面两个脚本共用的解析器

assets/
  site-config.js      唯一配置点：Supabase URL / anon key / 站点链接
  styles.css          由 _shared/sync.ps1 拼出来的成品样式，别手改
  main.js / sb.js / auth.js   三站共用的公共脚本
  content.js          运行时把 Supabase 的文章合并到静态数据上
  posts-render.js     首页列表与活动卡片
  article.js          详情页与阅读数
  guestbook.js        留言板
  admin.js            管理员登录、发文、改文、删文
  posts.js            【生成物】静态文章数据，勿手改
  icon.png / favicon.png   班徽：一方印，刻一个「八」

supabase/
  schema.sql          整库结构 + 函数 + RLS（可重复执行）
  seed.sql            口令与初始文章（可重复执行）
```

---

## 日常怎么改内容

**加一篇文章**：在 `content/posts/` 新建一个 `.md`：

```yaml
---
slug: "banji-yuebao-1"     # 必须唯一，只能是英文小写/数字/连字符
cat: "news"                # news / activity / notice
title: "十一月月报"
date: "2026-11-30"
byline: "班委会"
excerpt: "一句话摘要"
order: 10
---
正文第一段。

正文第二段。
```

然后：

```bash
node scripts/build-posts.mjs
```

写完 `assets/posts.js` 与 `sitemap.xml`。推上去就生效。

> 想连数据库一起更新，直接在网页上登录管理员改，不用碰 md。
> 两边都能编辑时以数据库为准（运行时合并，数据库覆盖静态）。

---

## 接数据库（三步，只做一次）

三个站共用**一个** Supabase 项目。

1. 在 [supabase.com](https://supabase.com) 新建项目，区域选 **Singapore**（离国内最近）。
2. 打开 **SQL Editor → New query**，把 `supabase/schema.sql` 整段粘进去 → Run。
   再新建一个 query，跑 `supabase/seed.sql`。
3. 打开 **Settings → API**，把 `Project URL` 和 `anon public` 两个值填进
   `assets/site-config.js` 的 `supabase.url` / `supabase.anonKey`。

没填也能跑：文章走静态版，留言板会显示「数据库还没接」，不会报错。

### 口令

`node scripts/gen-seed.mjs` 会生成 1 个班级口令 + 4 个管理员密钥，
明文写在**仓库外**的 `../keys/bhsf202808-keys.txt`，数据库里只有 sha256。

-

- 班级口令：全班通用，`.fun` / `.site` 用，30 天有效。
- 管理员密钥：发文、删留言、回复悄悄话、回答提问，24 小时有效。

作废一把：数据库里把 `b8_keys` 那一行 `active` 改成 `false`。

---

## 发布

```bash
git add -A
git commit -m "更新内容"
git push
```

GitHub → Settings → Pages：
- Source：`Deploy from a branch`，分支 `main`，目录 `/`
- Custom domain：填 `bhsf202808.homes` → Save
- 等证书签发（通常 1–60 分钟），签发后勾上 **Enforce HTTPS**

DNS（在域名服务商那侧）：

| 记录 | 值 |
|---|---|
| `A @` | `185.199.108.153` `185.199.109.153` `185.199.110.153` `185.199.111.153` |
| `CNAME www` | `aabb16380.github.io` |

不要加 `AAAA`，不要加 `CAA`（除非你确认里面包含 `letsencrypt.org`）。

### 验收

```bash
curl -sI https://bhsf202808.homes/ | head -3        # 200 + Server: GitHub.com
curl -sL https://bhsf202808.homes/ | grep -c 'brand-ver'   # 1
curl -s  https://bhsf202808.homes/test/ | grep -c location.replace
```

浏览器打开 `/test/`，顶部版本号旁边应有红字 **TEST**。

---

## 设计与实现约定

- 视觉是「纸 · 墨 · 印」：米白纸底 + 32px 极淡方格 + 1px 墨线 + 印章红。
  标题用宋体族，正文用系统黑体，元信息用等宽字体。
- 班徽取「八」字入印，三站统一，只换颜色（纪事用绛红、游乐场用赭石、树洞用紫）。
- 不放任何 CDN、字体文件、统计脚本、第三方框架。国内打开快，也不怕被墙。
- 所有写操作走 `security definer` 的 RPC：匿名 key 只能读，写要靠函数校验令牌。
- 日期、人数这类显示统一走 `B8.date()` / `B8.num()`，避免「09 月」这种前导零。
- 静态优先：任何一块内容在数据库挂掉时都要能降级，不能白屏。

---

## 常见问题

**首页说「数据库未接入」** → `assets/site-config.js` 里的 url/anonKey 还是空的，或者没跑 `schema.sql`。

**文章阅读数一直是 0** → 阅读数靠 RPC `b8_bump_views` 累加，它会在文章不存在时先建行。
如果还是 0，检查 `content.js` 的 select 里是否带上了 `views` 字段。

**改了样式没变化** → 样式是 `_shared/sync.ps1` 拼出来的，要重跑一次；
线上还要把 `index.html` 里的 `?v=` 构建号改一下，否则浏览器和 CDN 都会给旧版本。

**手机微信里提示未完成 ICP 备案** → GitHub Pages 无法备案（备案要求国内接入商）。
这个提示来自微信，页面底部有「继续访问」，跟 https 无关，技术手段消除不了。
