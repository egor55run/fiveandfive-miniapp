// IndexNow (2026-11-01): сообщить Bing и Яндексу, какие адреса сайта изменились.
//
// Список адресов — из sitemap.xml. «Изменился» — у страницы другой отпечаток
// HTML, чем при прошлой отправке (state-файл на сервере): новые адреса, правки
// текста, заголовков, разметки. Отсчёт до старта на главной в отпечаток не
// входит — он меняется каждую секунду. Пропавшие из sitemap адреса тоже
// отправляются: так поисковик быстрее узнает, что страницы больше нет.
//
// Запуск — на сервере, из scripts/deploy-web.sh после выкладки прода:
//   ssh <host> "node --input-type=module - [--all] [--dry-run]" < scripts/indexnow.mjs
// --all      отправить все адреса из sitemap, а не только изменённые;
// --dry-run  только показать запрос: ничего не отправлять и не запоминать.
// INDEXNOW_SITE — чей sitemap читать (по умолчанию прод). Отправка — только для
// fiveandfive.kz: staging закрыт от индексации, его адреса поисковикам не нужны.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Ключ не секрет: он же лежит открыто в public/<ключ>.txt — так поисковик
// проверяет, что запрос пришёл от владельца сайта.
const KEY = '5b6bc98fa9e0a941c8bca1d56ac4172c';
const PROD_HOST = 'fiveandfive.kz';
const ENDPOINTS = ['https://yandex.com/indexnow', 'https://www.bing.com/indexnow'];

const site = (process.env.INDEXNOW_SITE || `https://${PROD_HOST}`).replace(/\/+$/, '');
const host = new URL(site).host;
const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
const statePath = process.env.INDEXNOW_STATE || path.join(homedir(), `indexnow-state-${host}.json`);

const log = (msg) => console.log(`==> IndexNow: ${msg}`);

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'fiveandfive-indexnow' } });
  return { status: res.status, text: await res.text() };
}

/** Отпечаток страницы: HTML без скриптов сборки, ссылок на ассеты и отсчёта. */
function fingerprint(status, html) {
  const normalized = html
    .replace(/<script(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link(?![^>]*rel="(?:canonical|alternate)")[^>]*>/g, '')
    .replace(/(<span class="h-count__value">)[^<]*/g, '$1')
    .replace(/\s+/g, ' ');
  return `${status}:${createHash('sha256').update(normalized).digest('hex')}`;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return {};
  }
}

const sitemap = await get(`${site}/sitemap.xml`);
if (sitemap.status !== 200) throw new Error(`sitemap.xml: HTTP ${sitemap.status}`);
const urls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (urls.length === 0) throw new Error('В sitemap.xml нет адресов');

const prev = await loadState();
const next = {};
for (const url of urls) {
  const page = await get(url);
  next[url] = fingerprint(page.status, page.text);
}
const removed = Object.keys(prev).filter((url) => !(url in next));
const changed = all ? urls : [...urls.filter((url) => prev[url] !== next[url]), ...removed];

if (changed.length === 0) {
  log(`изменений нет (${urls.length} адресов в sitemap)`);
  process.exit(0);
}

const payload = { host, key: KEY, keyLocation: `${site}/${KEY}.txt`, urlList: changed };
log(`${all ? 'все адреса' : 'изменённые адреса'}: ${changed.length} из ${urls.length}${removed.length ? ` (убраны из sitemap: ${removed.length})` : ''}`);

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  log('--dry-run: ничего не отправлено');
  process.exit(0);
}
if (host !== PROD_HOST) {
  log(`отправка только для ${PROD_HOST}, а это ${host} — пропускаю`);
  process.exit(0);
}

// Без доступного ключ-файла поисковик запрос не примет.
const keyFile = await get(payload.keyLocation);
if (keyFile.status !== 200 || keyFile.text.trim() !== KEY) {
  throw new Error(`ключ-файл ${payload.keyLocation} недоступен (HTTP ${keyFile.status})`);
}

let ok = true;
for (const endpoint of ENDPOINTS) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.text()).slice(0, 200);
    // 200 — принято, 202 — принято, ключ ещё проверяется.
    const accepted = res.status === 200 || res.status === 202;
    if (!accepted) ok = false;
    log(`${new URL(endpoint).host}: HTTP ${res.status}${body ? ` ${body}` : ''}`);
  } catch (err) {
    ok = false;
    log(`${new URL(endpoint).host}: сбой — ${err.message}`);
  }
}

// Запоминаем, только если приняли оба: иначе следующая выкладка отправит снова.
if (ok) {
  await writeFile(statePath, JSON.stringify(next, null, 1));
  log(`отправлено, состояние — ${statePath}`);
} else {
  log('не все поисковики приняли запрос — при следующей выкладке отправим снова');
  process.exit(1);
}
