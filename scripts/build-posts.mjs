/**
 * content/posts/*.md → assets/posts.js（静态兜底数据）+ sitemap.xml
 *
 * 用法：node scripts/build-posts.mjs
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPosts } from './lib/posts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITE = 'https://bhsf202808.homes';

let categories, posts;
try {
  ({ categories, posts } = loadPosts(ROOT));
} catch (err) {
  console.error('\n✗ ' + err.message + '\n');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 10);

/* ---------- assets/posts.js ---------- */
const banner =
  `/* 自动生成，请勿手改。\n` +
  `   源文件：content/posts/*.md  生成：${stamp}  共 ${posts.length} 篇\n` +
  `   重新生成：node scripts/build-posts.mjs */\n`;

writeFileSync(
  join(ROOT, 'assets', 'posts.js'),
  banner +
    'window.B8_CATS = ' + JSON.stringify(categories, null, 2) + ';\n\n' +
    'window.B8_POSTS = ' + JSON.stringify(posts, null, 2) + ';\n',
  'utf8'
);

const kb = (Buffer.byteLength(JSON.stringify(posts)) / 1024).toFixed(1);
console.log(`✓ ${posts.length} 篇 → assets/posts.js（${kb} KB）`);
for (const p of posts) {
  console.log(`  ${p.date}  ${p.cat.padEnd(9)} ${p.slug.padEnd(18)} ${p.title}`);
}

/* ---------- sitemap.xml ---------- */
const urls = [
  { loc: SITE + '/', pri: '1.0' },
  { loc: SITE + '/log.html', pri: '0.5' }
].concat(
  posts.map((p) => ({
    loc: SITE + '/article.html?slug=' + encodeURIComponent(p.slug),
    pri: '0.7',
    lastmod: p.date
  }))
);

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls
    .map(
      (u) =>
        '  <url><loc>' + u.loc.replace(/&/g, '&amp;') + '</loc>' +
        '<lastmod>' + (u.lastmod || stamp) + '</lastmod>' +
        '<priority>' + u.pri + '</priority></url>'
    )
    .join('\n') +
  '\n</urlset>\n';

writeFileSync(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
console.log(`✓ sitemap.xml（${urls.length} 条）`);
