/**
 * 生成管理员/班级口令 + supabase/seed.sql
 *
 * 用法：node scripts/gen-seed.mjs
 *
 * 安全约定：
 *  · 库里只存 sha256，永远不存明文；
 *  · 明文只写到仓库外的 keys/ 目录（本脚本默认 ../keys/），绝不进 git；
 *  · 想作废一把，把 b8_keys 那一行的 active 改成 false 即可。
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt } from 'node:crypto';
import { loadPosts } from './lib/posts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const KEYS_DIR = join(ROOT, '..', 'keys');
const KEYS_FILE = join(KEYS_DIR, 'bhsf202808-keys.txt');
const SEED_FILE = join(ROOT, 'supabase', 'seed.sql');

// 去掉容易看错的 I O 0 1
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function block(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

function makeKey() {
  return 'B8-' + block(4) + '-' + block(4) + '-' + block(4);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sqlStr(value) {
  return "'" + String(value == null ? '' : value).replace(/'/g, "''") + "'";
}

/* 幂等：已经生成过就别重新生成（重新生成会让已发出去的口令全部作废） */
const force = process.argv.includes('--force');
if (existsSync(KEYS_FILE) && !force) {
  console.log('· 已存在 ' + KEYS_FILE + '，跳过口令生成（要重新生成加 --force）');
}

const keys = [];
if (!existsSync(KEYS_FILE) || force) {
  keys.push({ kind: 'class', label: '八班通用口令', plain: makeKey() });
  const admins = [
    '班长', '副班长', '技术组', '备用'
  ];
  admins.forEach((label) => keys.push({ kind: 'admin', label, plain: makeKey() }));

  mkdirSync(KEYS_DIR, { recursive: true });
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = [
    '北京四中 2028 届 8 班 · 三站口令',
    '生成时间：' + now,
    '==================================================',
    '',
    '【班级口令】发给全班，可以一人一份，也可以只在班群里发一次',
    '  用法：打开 bhsf202808.fun 或 bhsf202808.site，输入即可，30 天有效',
    ''
  ];
  keys.forEach((k, i) => {
    lines.push(
      (k.kind === 'class' ? '  #' : '  A') + (i + 1) + '  ' + k.label.padEnd(8, ' ') + '  ' + k.plain
    );
    lines.push('       sha256: ' + sha256(k.plain));
    lines.push('');
  });
  lines.push(
    '==================================================',
    '注意：',
    '· 明文只在这份文件里，数据库只存 sha256',
    '· 谁拿到管理员密钥谁就是管理员，泄露了去数据库把 active 改成 false',
    '· 班级口令泄漏了也一样，重新生成一把新的（node scripts/gen-seed.mjs --force）'
  );
  writeFileSync(KEYS_FILE, lines.join('\n') + '\n', 'utf8');
  console.log('✓ 口令写到 ' + KEYS_FILE);
} else {
  // 从已有文件里把明文读回来，保证 seed.sql 与文件一致
  const raw = readFileSync(KEYS_FILE, 'utf8');
  const re = /(?:#|A)(\d+)\s+(\S+)\s+(B8-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/g;
  let m;
  while ((m = re.exec(raw))) {
    keys.push({
      kind: m[1] === '1' ? 'class' : 'admin',
      label: m[2],
      plain: m[3]
    });
  }
  console.log('· 从文件读回 ' + keys.length + ' 把口令');
}

/* ---------- seed.sql ---------- */
let { posts } = loadPosts(ROOT);

const keyRows = keys
  .map((k) => `  (${sqlStr(k.kind)}, ${sqlStr(k.label)}, ${sqlStr(sha256(k.plain))})`)
  .join(',\n');

const postRows = posts
  .map(
    (p) =>
      `  (${sqlStr(p.slug)}, ${sqlStr(p.cat)}, ${sqlStr(p.title)}, ${sqlStr(p.date)}, ` +
      `${sqlStr(p.excerpt)}, ${sqlStr(p.byline)}, ${sqlStr(p.body)}, 0, ${Number(p.order) || 100}, true)`
  )
  .join(',\n');

const seed = `-- ============================================================
--  北京四中 2028 届 8 班 · 初始数据
--  由 scripts/gen-seed.mjs 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })}
--  可重复执行：全部 on conflict do nothing
--
--  先跑 schema.sql，再跑这个文件。
-- ============================================================

-- 1. 口令（只存 sha256）
insert into public.b8_keys (kind, label, hash) values
${keyRows}
on conflict (hash) do nothing;

-- 2. 初始文章（与 content/posts/*.md 一致）
insert into public.b8_posts
  (slug, cat, title, date, excerpt, byline, body, views, sort_order, published)
values
${postRows}
on conflict (slug) do nothing;

-- 3. 自检
-- select kind, label, active from public.b8_keys order by kind, id;
-- select slug, title, date from public.b8_posts order by date desc;
`;

writeFileSync(SEED_FILE, seed, 'utf8');
console.log('✓ ' + SEED_FILE + `（${keys.length} 把口令 / ${posts.length} 篇文章）`);
