/**
 * Самопроверка авторизации админки.
 *
 *   npx tsx scripts/selftest-admin-auth.ts
 *
 * Главное здесь — перекрёстная проверка двух схем подписи. Login Widget и
 * initData Mini App выводят секрет по-разному:
 *
 *   initData:      secret = HMAC_SHA256(key: "WebAppData", msg: bot_token)
 *   Login Widget:  secret = SHA256(bot_token)
 *
 * Если перепутать их местами, подпись «почти работает» — и легко решить, что
 * проблема в чём-то другом. Тест ловит именно это: данные, подписанные одной
 * схемой, не должны проходить проверку другой.
 *
 * Реальный BOT_TOKEN не нужен: проверяется алгоритм.
 */
import { createHash, createHmac } from 'node:crypto';
import { verifyInitData } from '../src/lib/telegramAuth';
import {
  adminTelegramIds,
  isAdminTelegramId,
  verifyLoginWidget,
  type LoginWidgetFields,
} from '../src/lib/telegramLogin';

const TOKEN = process.env.BOT_TOKEN ?? 'test:dummy-token-for-selftest';
const nowSec = () => Math.floor(Date.now() / 1000);

function dataCheckString(fields: LoginWidgetFields): string {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${String(fields[k])}`)
    .join('\n');
}

/** Подпись по схеме Login Widget: secret = SHA256(token). */
function signWidget(fields: LoginWidgetFields): LoginWidgetFields {
  const secret = createHash('sha256').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString(fields)).digest('hex');
  return { ...fields, hash };
}

/** Подпись по схеме initData: secret = HMAC(key "WebAppData", msg token). */
function signWithMiniAppScheme(fields: LoginWidgetFields): LoginWidgetFields {
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString(fields)).digest('hex');
  return { ...fields, hash };
}

let failed = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} ${got} (ждали ${want})`);
}

const outcome = (f: LoginWidgetFields) => {
  const r = verifyLoginWidget(f, TOKEN);
  return r.ok ? 'ok' : r.reason;
};

const base: LoginWidgetFields = {
  id: 1478531033,
  first_name: 'Егор',
  username: 'egorkad24',
  photo_url: 'https://t.me/i/userpic/320/abc.jpg',
  auth_date: nowSec(),
};

console.log('\n=== Подпись Login Widget ===');
const valid = signWidget(base);
check('валидный payload', outcome(valid), 'ok');

const parsed = verifyLoginWidget(valid, TOKEN);
check(
  'id прочитан',
  parsed.ok ? String(parsed.user.id) : 'нет',
  String(base.id),
);

check('подменённый id при том же hash', outcome({ ...valid, id: 999 }), 'bad_hash');
check('лишнее поле, не участвовавшее в подписи', outcome({ ...valid, role: 'admin' }), 'bad_hash');
check('без hash', outcome({ ...base }), 'no_hash');
check('мусор в hash', outcome({ ...valid, hash: 'zz' }), 'bad_hash');

console.log('\n=== Свежесть (окно 5 минут, в отличие от 24 часов у initData) ===');
check(
  'auth_date 10 минут назад',
  outcome(signWidget({ ...base, auth_date: nowSec() - 10 * 60 })),
  'stale',
);
check(
  'auth_date 2 минуты назад',
  outcome(signWidget({ ...base, auth_date: nowSec() - 2 * 60 })),
  'ok',
);

console.log('\n=== Аккаунт без фамилии (ваш случай) ===');
const noLastName = signWidget({ id: 1478531033, first_name: 'Егор', auth_date: nowSec() });
check('payload без last_name', outcome(noLastName), 'ok');
check(
  'last_name, добавленный пустым, ломает подпись',
  outcome({ ...noLastName, last_name: '' }),
  'bad_hash',
);

console.log('\n=== ПЕРЕКРЁСТНАЯ ПРОВЕРКА СХЕМ (главный тест) ===');
check(
  'данные, подписанные схемой initData -> проверка виджета',
  outcome(signWithMiniAppScheme(base)),
  'bad_hash',
);

// Обратное направление: строка в формате initData, но подписанная схемой виджета.
const initDataFields = {
  auth_date: String(nowSec()),
  user: JSON.stringify({ id: 1478531033, first_name: 'Егор' }),
};
const dcs = Object.keys(initDataFields)
  .sort()
  .map((k) => `${k}=${initDataFields[k as keyof typeof initDataFields]}`)
  .join('\n');
const widgetSecret = createHash('sha256').update(TOKEN).digest();
const wrongParams = new URLSearchParams(initDataFields);
wrongParams.set('hash', createHmac('sha256', widgetSecret).update(dcs).digest('hex'));
const initResult = verifyInitData(wrongParams.toString(), TOKEN);
check(
  'данные, подписанные схемой виджета -> проверка initData',
  initResult.ok ? 'ok' : initResult.reason,
  'bad_hash',
);

console.log('\n=== Список администраторов (fail-closed) ===');
const saved = process.env.ADMIN_TELEGRAM_IDS;

process.env.ADMIN_TELEGRAM_IDS = '';
check('пустой список -> никто не админ', String(isAdminTelegramId(1478531033)), 'false');
check('пустой список -> размер набора', String(adminTelegramIds().size), '0');

delete process.env.ADMIN_TELEGRAM_IDS;
check('переменная не задана -> никто не админ', String(isAdminTelegramId(1478531033)), 'false');

process.env.ADMIN_TELEGRAM_IDS = '1478531033, 555000222';
check('id из списка', String(isAdminTelegramId(1478531033)), 'true');
check('второй id из списка (пробелы не мешают)', String(isAdminTelegramId(555000222)), 'true');
check('посторонний id', String(isAdminTelegramId(42)), 'false');

process.env.ADMIN_TELEGRAM_IDS = 'не-число,,0,-5';
check('мусор в списке -> никто не админ', String(adminTelegramIds().size), '0');

if (saved === undefined) delete process.env.ADMIN_TELEGRAM_IDS;
else process.env.ADMIN_TELEGRAM_IDS = saved;

if (failed > 0) {
  console.error(`\n${failed} проверок провалено`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
