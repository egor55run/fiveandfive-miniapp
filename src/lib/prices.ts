/**
 * Показывать ли цены. Одно правило для сайта, Mini App, бота и разметки
 * schema.org (2026-11-10): переключатель «Показывать цены» в админке, его
 * значение приходит с каждым стартом (EventDto.pricesPublic). Пока выключен —
 * вместо суммы «Цена будет объявлена», в разметке цены нет. Исключение одно:
 * итог к оплате в форме записи и экран счёта показывают сумму всегда — без неё
 * не заплатить (форма доступна, только когда регистрация открыта, или админам).
 *
 * Mini App: значение ставит App после загрузки стартов (setPricesPublic).
 * Сайт: страницы берут его из своего старта и передают явно.
 */
let pricesPublic = false;

export function setPricesPublic(value: boolean): void {
  pricesPublic = value;
}

export const isPricesPublic = (): boolean => pricesPublic;

export const PRICE_TBD = 'Цена будет объявлена';

const fmt = new Intl.NumberFormat('ru-RU');

/** «5 000 ₸» или, пока цены не объявлены (или суммы нет), — «Цена будет объявлена». */
export function priceLabel(amount: number): string {
  return pricesPublic && amount > 0 ? `${fmt.format(amount)} ₸` : PRICE_TBD;
}

/** Сумма для коротких строк (список стартов): null — не показывать вовсе. */
export function priceShort(amount: number): string | null {
  return pricesPublic && amount > 0 ? `${fmt.format(amount)}₸` : null;
}
