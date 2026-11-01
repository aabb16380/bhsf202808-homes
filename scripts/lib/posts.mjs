/**
 * content/posts/*.md 的解析与校验（build-posts 和 gen-seed 共用）
 *
 * 为什么单独抽出来：文章既要生成静态 assets/posts.js，也要生成
 * supabase/seed.sql。两边各写一份解析器，迟早会漂。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export function loadPosts(root) {
  const postsDir = join(root, 'content', 'posts');
  const catsPath = join(root, 'content', 'categories.json');

  if (!existsSync(catsPath)) throw new Error('缺少 content/categories.json');
  const categories = JSON.parse(readFileSync(catsPath, 'utf8'));
  const catKeys = new Set(Object.keys(categories));

  if (!existsSync(postsDir)) throw new Error('缺少 content/posts 目录');
  const files = readdirSync(postsDir).filter((f) => f.endsWith('.md'));
  if (!files.length) throw new Error('content/posts 里一篇文章都没有');

  const seen = new Map();
  const posts = [];

  for (const file of files) {
    const raw = readFileSync(join(postsDir, file), 'utf8');
    const { meta, body } = parseFrontMatter(raw, file);

    const slug = (meta.slug || basename(file, '.md')).trim();
    if (!slug) throw new Error(`${file}：slug 为空`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      throw new Error(`${file}：slug「${slug}」只能用英文小写、数字和连字符（它同时是数据表主键）`);
    }
    if (seen.has(slug)) {
      throw new Error(
        `slug 冲突：「${slug}」同时出现在 ${seen.get(slug)} 和 ${file}\n` +
          '  数据表里 slug 是主键，两篇会抢同一行。改一个再构建。'
      );
    }
    seen.set(slug, file);

    const cat = (meta.cat || 'news').trim();
    if (!catKeys.has(cat)) {
      throw new Error(`${file}：cat「${cat}」不在 categories.json 里（可选：${[...catKeys].join(' / ')}）`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) {
      throw new Error(`${file}：date 必须是 YYYY-MM-DD，现在是「${meta.date || ''}」`);
    }

    const html = normalizeBody(body);
    const text = stripTags(html);

    posts.push({
      slug,
      cat,
      title: meta.title || slug,
      date: meta.date,
      byline: meta.byline || '',
      excerpt: meta.excerpt || text.slice(0, 60),
      order: Number(meta.order || 100),
      sample: String(meta.sample || '') === 'true',
      words: text.length,
      body: html
    });
  }

  posts.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.order - b.order;
  });

  return { categories, posts };
}

export function parseFrontMatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}：缺少 front matter（文件开头要有 --- 包起来的元信息）`);

  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[kv[1]] = value;
  }
  return { meta, body: m[2].trim() };
}

/** 纯文本段落自动包 <p>；已经是 HTML 的原样保留 */
export function normalizeBody(body) {
  if (!body) return '';
  if (/<(p|h[1-6]|ul|ol|blockquote|figure|div|table|img|hr)[\s>]/i.test(body)) {
    return body;
  }
  return body
    .split(/\r?\n\r?\n+/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => '<p>' + para.replace(/\r?\n/g, '<br>') + '</p>')
    .join('\n');
}

export function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
