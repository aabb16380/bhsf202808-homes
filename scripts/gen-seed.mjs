/**
 * 生成账号花名册 + 密钥 + 初始文章 → supabase/seed.sql
 *
 * 用法：node scripts/gen-seed.mjs            （已有明文就沿用，不重新生成）
 *       node scripts/gen-seed.mjs --force    （重新生成全部密钥，旧的立刻作废）
 *
 * 安全约定：
 *  · 库里只存 sha256，永远不存明文；
 *  · 明文只写到仓库外的 keys/ 目录，绝不进 git；
 *  · 想停用一把，网页上超级管理员点一下就行，也可以直接改 b8_admin_keys.active。
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
const ROSTER = join(ROOT, 'content', 'roster.json');

const ADMIN_COUNT = 15;
const SUPER_COUNT = 3;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 I O 0 1

const block = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');
const makeKey = (prefix) => `${prefix}-${block(4)}-${block(4)}-${block(4)}`;
const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
const sqlStr = (v) => "'" + String(v ?? '').replace(/'/g, "''") + "'";

/* ---------- 密钥 ---------- */
const force = process.argv.includes('--force');
const keys = [];

function readKeysFile() {
  const raw = readFileSync(KEYS_FILE, 'utf8');
  const re = /\[(\w+)\]\s+(\S+)\s{2,}((?:B8|SU)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/g;
  let m;
  while ((m = re.exec(raw))) {
    keys.push({ kind: m[1], label: m[2], plain: m[3] });
  }
}

if (existsSync(KEYS_FILE) && !force) {
  readKeysFile();
  console.log(`· 沿用已有明文：${keys.length} 把（要重发加 --force）`);
}

if (!keys.length || force) {
  keys.length = 0;
  for (let i = 1; i <= SUPER_COUNT; i++) {
    keys.push({ kind: 'super', label: `超级管理员 ${String(i).padStart(2, '0')}`, plain: makeKey('SU') });
  }
  for (let i = 1; i <= ADMIN_COUNT; i++) {
    keys.push({ kind: 'admin', label: `管理员 ${String(i).padStart(2, '0')}`, plain: makeKey('B8') });
  }

  mkdirSync(KEYS_DIR, { recursive: true });
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = [
    '北京四中 2028 届 8 班 · 三站密钥',
    '生成时间：' + now,
    '==================================================',
    '',
    '【怎么用】',
    '  1. 先用自己的学号 + 密码登录站点',
    '  2. 登录后点「管理员」，输入下面任意一把密钥',
    '  3. 权限只在本浏览器这一次会话里有效（2 小时 / 关掉标签页就没了）',
    '  4. 一把密钥第一次被谁用，就永久绑给谁，别人再用会报错',
    '',
    '【超级管理员 3 把】可以管密钥、管密码、改留言',
    ''
  ];
  keys.filter((k) => k.kind === 'super').forEach((k, i) => {
    lines.push(`[super] ${k.label}  ${k.plain}`);
    lines.push(`        sha256: ${sha256(k.plain)}`);
    lines.push('');
  });
  lines.push('【管理员 15 把】可以改任何文章、删留言、回复悄悄话', '');
  keys.filter((k) => k.kind === 'admin').forEach((k) => {
    lines.push(`[admin] ${k.label}  ${k.plain}`);
    lines.push(`        sha256: ${sha256(k.plain)}`);
    lines.push('');
  });
  lines.push(
    '==================================================',
    '注意：',
    '· 明文只在这份文件里，数据库只存 sha256',
    '· 密钥转借会失效（绑定第一个使用它的账号）',
    '· 丢了/泄露了：超级管理员在网页上停用那一条即可，不用重发',
    '· 全部重发：node scripts/gen-seed.mjs --force，然后重跑 seed.sql'
  );
  writeFileSync(KEYS_FILE, lines.join('\n') + '\n', 'utf8');
  console.log('✓ 生成 ' + keys.length + ' 把密钥 → ' + KEYS_FILE);
  if (force) console.log('  ⚠ 这是 --force 结果：旧密钥全部作废');
}

/* ---------- 花名册 ---------- */
if (!existsSync(ROSTER)) throw new Error('缺少 content/roster.json');
const roster = JSON.parse(readFileSync(ROSTER, 'utf8'));
const members = roster.members || [];
if (!members.length) throw new Error('roster.json 里没有 members');
for (const m of members) {
  if (!/^\d{6,12}$/.test(m.no)) throw new Error(`学号不合法：${m.no}`);
  if (!m.name || m.name.length < 2) throw new Error(`姓名不合法：${m.no}`);
}
console.log(`· 花名册 ${members.length} 人`);

/* ---------- 文章 ---------- */
let posts;
try {
  ({ posts } = loadPosts(ROOT));
} catch (err) {
  console.error('\n✗ ' + err.message + '\n');
  process.exit(1);
}

/* ---------- seed.sql ---------- */
const memberRows = members
  .map((m) => `  (${sqlStr(m.no)}, ${sqlStr(m.name)})`)
  .join(',\n');

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
--  北京四中 2028 届 8 班 · 初始数据  v2.0
--  由 scripts/gen-seed.mjs 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })}
--  可重复执行：全部 on conflict do nothing
--  先跑 schema.sql，再跑这个文件。
-- ============================================================

-- 1. 花名册（还没有密码，第一次登录时自己设）
insert into public.b8_members (student_no, name) values
${memberRows}
on conflict (student_no) do nothing;

-- 2. 密钥（只存 sha256；kind = admin / super）
insert into public.b8_admin_keys (kind, label, hash) values
${keyRows}
on conflict (hash) do nothing;

-- 3. 初始文章（与 content/posts/*.md 一致）
insert into public.b8_posts
  (slug, cat, title, date, excerpt, byline, body, views, sort_order, published)
values
${postRows}
on conflict (slug) do nothing;

-- 4. 自检
-- select count(*) from public.b8_members;      -- ${members.length}
-- select kind, count(*) from public.b8_admin_keys group by kind;  -- super ${keys.filter(k=>k.kind==='super').length} / admin ${keys.filter(k=>k.kind==='admin').length}
-- select count(*) from public.b8_posts;        -- ${posts.length}
`;

writeFileSync(SEED_FILE, seed, 'utf8');
console.log(
  `✓ seed.sql：${members.length} 人 / ${keys.filter((k) => k.kind === 'super').length} 超管 + ` +
    `${keys.filter((k) => k.kind === 'admin').length} 管理员 / ${posts.length} 篇文章`
);
