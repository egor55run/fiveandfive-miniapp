/**
 * Самопроверка проверки подписи initData.
 *
 *   npx tsx scripts/selftest-telegram-auth.ts
 *
 * Подписывает данные тем же алгоритмом, что Telegram, и убеждается, что
 * verifyInitData принимает валидную подпись и отвергает подделки.
 *
 * Токен берётся из BOT_TOKEN, иначе используется фиктивный — для проверки
 * самого алгоритма реальный токен не нужен. Если BOT_TOKEN задан, скрипт
 * дополнительно печатает валидный initData: его можно подставить в curl
 * (`Authorization: tma <строка>`) и проверить живые эндпоинты.
 */
import { createHmac } from 'node:crypto';
import { verifyInitData, type InitDataFailure } from '../src/lib/telegramAuth';

const token = process.env.BOT_TOKEN ?? 'test:dummy-token-for-selftest';
const usingRealToken = Boolean(process.env.BOT_TOKEN);

/** Подписывает набор полей так же, как это делает Telegram. */
function sign(fields: Record<string, string>): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const nowSec = Math.floor(Date.now() / 1000);
const user = {
  id: 555000111,
  first_name: 'Тест',
  last_name: 'Тестов',
  username: 'test_user',
  language_code: 'ru',
};

let failed = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (получено: ${got}, ожидалось: ${want})`);
}

function outcome(initData: string): string {
  const r = verifyInitData(initData, token);
  return r.ok ? 'ok' : r.reason;
}

// 1. Валидная подпись принимается, пользователь распознан.
const valid = sign({
  auth_date: String(nowSec),
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify(user),
});
check('валидная подпись', outcome(valid), 'ok');
const parsed = verifyInitData(valid, token);
check(
  'id пользователя прочитан',
  parsed.ok ? String(parsed.user.id) : 'нет',
  String(user.id),
);

// 2. Подделка: меняем id, hash оставляем прежним.
const tampered = valid.replace(
  encodeURIComponent(String(user.id)),
  encodeURIComponent('999999999'),
);
check('подменённый id пользователя', outcome(tampered), 'bad_hash');

// 3. Подпись от другого токена не проходит.
const foreignSecret = createHmac('sha256', 'WebAppData').update('other:token').digest();
const foreignParams = new URLSearchParams({
  auth_date: String(nowSec),
  user: JSON.stringify(user),
});
foreignParams.set(
  'hash',
  createHmac('sha256', foreignSecret)
    .update(`auth_date=${nowSec}\nuser=${JSON.stringify(user)}`)
    .digest('hex'),
);
check('подпись чужим токеном', outcome(foreignParams.toString()), 'bad_hash');

// 4. Просроченный initData.
const stale = sign({
  auth_date: String(nowSec - 25 * 60 * 60),
  user: JSON.stringify(user),
});
check('auth_date 25 часов назад', outcome(stale), 'stale');

// 5. Свежий на границе окна (23 часа) всё ещё валиден.
const fresh = sign({
  auth_date: String(nowSec - 23 * 60 * 60),
  user: JSON.stringify(user),
});
check('auth_date 23 часа назад', outcome(fresh), 'ok');

// 6. Вырожденные случаи.
check('пустая строка', outcome(''), 'empty' satisfies InitDataFailure);
check('без hash', outcome('auth_date=1&user=%7B%7D'), 'no_hash');
check('без user', outcome(sign({ auth_date: String(nowSec) })), 'no_user');

// 7. Поле signature участвует в подписи и не ломает проверку.
const withSignature = sign({
  auth_date: String(nowSec),
  user: JSON.stringify(user),
  signature: 'Ed25519_stub_signature_value',
});
check('initData с полем signature', outcome(withSignature), 'ok');

console.log(
  `\nТокен: ${usingRealToken ? 'реальный из BOT_TOKEN' : 'фиктивный (проверяется только алгоритм)'}`,
);
if (usingRealToken) {
  console.log('\nВалидный initData для curl:\n');
  console.log(valid);
}

if (failed > 0) {
  console.error(`\n${failed} проверок провалено`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
