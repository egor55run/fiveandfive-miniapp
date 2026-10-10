import { registrationState, type EventDto } from '../../lib/api';
import type { Lang } from '../../lib/legal';
import { botChatLink, botRaceLink } from '../../site/links';
import { siteText } from '../../site/i18n';

/**
 * Кнопка регистрации на сайте — те же состояния, что в Mini App
 * (registrationState): регистрация идёт в боте, сайт только ведёт туда.
 */
export default function RegistrationCta({ event, lang }: { event: EventDto; lang: Lang }) {
  const t = siteText(lang).cta;
  const state = registrationState(event);
  const soldOut = event.slotsLeft <= 0;

  if (state === 'ended') return <span className="cta cta--off">{t.ended}</span>;
  if (state === 'soon') {
    return (
      <div className="cta-group">
        <span className="cta cta--off">{t.soon}</span>
        {/* Подписка на открытие — бот запомнит и напишет (этап 2). */}
        <a className="cta-link" href={botChatLink(`notify-${event.slug ?? ''}`)}>
          {t.notify}
        </a>
      </div>
    );
  }
  if (soldOut) return <span className="cta cta--off">{t.soldOut}</span>;
  return (
    // Подпись для чтецов экрана — со стартом: на странице есть и общая
    // «Зарегистрироваться» в шапке, она ведёт в бота, а эта — сразу на старт.
    <a
      className="cta"
      href={event.slug ? botRaceLink(event.slug) : botChatLink()}
      aria-label={`${t.register}: ${event.title}`}
    >
      {t.register}
    </a>
  );
}
