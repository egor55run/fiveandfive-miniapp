import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * IndexNow из админки (2026-11-10): после правок, которые видны на сайте
 * (старты, цены, регистрация, вопросы, результаты), через минуту сверяем
 * страницы sitemap с прошлой отправкой и сообщаем Яндексу и Bing изменённые.
 * Та же логика и тот же файл состояния, что у scripts/indexnow.mjs при
 * выкладке, — адреса не уходят дважды. Отправка — только для fiveandfive.kz.
 */

const KEY = '5b6bc98fa9e0a941c8bca1d56ac4172c';
const PROD_HOST = 'fiveandfive.kz';
const ENDPOINTS = ['https://yandex.com/indexnow', 'https://www.bing.com/indexnow'];
const DELAY_MS = 60_000;

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

const site = () => (process.env.APP_URL || `https://${PROD_HOST}`).replace(/\/+$/, '');

async function get(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'fiveandfive-indexnow' } });
  return { status: res.status, text: await res.text() };
}

/** Как в scripts/indexnow.mjs: HTML без скриптов сборки, ассетов и отсчёта. */
function fingerprint(status: number, html: string): string {
  const normalized = html
    .replace(/<script(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link(?![^>]*rel="(?:canonical|alternate)")[^>]*>/g, '')
    .replace(/(<span class="h-count__value">)[^<]*/g, '$1')
    .replace(/\s+/g, ' ');
  return `${status}:${createHash('sha256').update(normalized).digest('hex')}`;
}

async function submitChanged(log: Logger): Promise<void> {
  const base = site();
  const host = new URL(base).host;
  const statePath = path.join(homedir(), `indexnow-state-${host}.json`);
  const sitemap = await get(`${base}/sitemap.xml`);
  if (sitemap.status !== 200) throw new Error(`sitemap.xml: HTTP ${sitemap.status}`);
  const urls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

  let prev: Record<string, string> = {};
  try {
    prev = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    // Первая отправка — все адреса.
  }
  const next: Record<string, string> = {};
  for (const url of urls) {
    const page = await get(url);
    next[url] = fingerprint(page.status, page.text);
  }
  const changed = [...urls.filter((u) => prev[u] !== next[u]), ...Object.keys(prev).filter((u) => !(u in next))];
  if (changed.length === 0) return;
  if (host !== PROD_HOST) {
    log.info({ host, changed: changed.length }, 'IndexNow: не прод — не отправляем');
    return;
  }

  const body = JSON.stringify({ host, key: KEY, keyLocation: `${base}/${KEY}.txt`, urlList: changed });
  let ok = true;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status !== 200 && res.status !== 202) ok = false;
    } catch {
      ok = false;
    }
  }
  // Не приняли — состояние не трогаем: адреса уйдут при следующей правке или выкладке.
  if (ok) await writeFile(statePath, JSON.stringify(next, null, 1));
  log.info({ changed: changed.length, ok }, 'IndexNow: изменённые страницы отправлены из админки');
}

let pending: NodeJS.Timeout | null = null;

/** Отложенная отправка: серия правок подряд — одна отправка через минуту после последней. */
export function scheduleIndexNow(log: Logger): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    submitChanged(log).catch((err) => log.warn({ err: String(err) }, 'IndexNow: сбой отправки из админки'));
  }, DELAY_MS);
  pending.unref();
}
