// Все файлы приложения должны быть в оффлайн-кэше service worker'а,
// иначе после установки на iPhone часть сайта не откроется без сети.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test('service worker кэширует все файлы приложения', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'icons'))].map((p) => relative(root, p));
  for (const f of [...files, 'index.html', 'styles.css', 'manifest.webmanifest']) {
    assert.ok(sw.includes(`'${f}'`), `${f} нет в sw.js — запустите scripts/build-sw.sh`);
  }
});

test('в клиенте нет секретного ключа Supabase', () => {
  for (const f of walk(join(root, 'src'))) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/service_role/.test(text.replace(/\/\/.*$/gm, '')), `${f} упоминает service_role вне комментария`);
  }
});
