/**
 * Показывать ли цены — и на сайте, и в Mini App. Пока цена не утверждена
 * (решение пользователя 2026-10-10), вместо суммы — «Цена будет объявлена»,
 * а в разметке для поисковиков цены нет вовсе. Суммы в базе остаются: на них
 * завязана оплата, и экран счёта показывает настоящую сумму всегда.
 * Включается сборкой: NEXT_PUBLIC_PRICES_PUBLIC=1 в scripts/deploy-web.sh.
 */
export const PRICES_PUBLIC = process.env.NEXT_PUBLIC_PRICES_PUBLIC === '1';

export const PRICE_TBD = 'Цена будет объявлена';

const fmt = new Intl.NumberFormat('ru-RU');

/** «5 000 ₸» или, пока цены не объявлены (или суммы нет), — «Цена будет объявлена». */
export function priceLabel(amount: number): string {
  return PRICES_PUBLIC && amount > 0 ? `${fmt.format(amount)} ₸` : PRICE_TBD;
}

/** Сумма для коротких строк (список стартов): null — не показывать вовсе. */
export function priceShort(amount: number): string | null {
  return PRICES_PUBLIC && amount > 0 ? `${fmt.format(amount)}₸` : null;
}
