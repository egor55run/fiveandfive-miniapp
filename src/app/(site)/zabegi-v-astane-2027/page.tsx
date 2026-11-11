import type { Metadata } from 'next';
import Link from 'next/link';
import { stagesOf } from '../../../lib/stages';
import type { EventDto } from '../../../lib/api';
import { docPath } from '../../../lib/legal';
import { anyRegistrationOpen, botChatLink, fetchEvents } from '../../../site/data';
import { siteText } from '../../../site/i18n';
import { HUB_PATH, hubJsonLd, jsonLdString, pageMeta, parkName } from '../../../site/seo';

/**
 * Хаб «Забеги в Астане 2027» (SEO-аудит 2026-11-01): все пять этапов сезона
 * кратко и со ссылками на страницы стартов. Даты, парки и время — из базы.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMeta({
  title: 'Забеги в Астане 2027: календарь серии из 5 забегов по 5 км',
  description:
    'Забеги в Астане в 2027 году: пять стартов на 5 км в парках города с мая по сентябрь. Даты, парки, время старта и регистрация на каждый этап серии 5&5.',
  path: HUB_PATH,
});

const TZ = 'Asia/Almaty';
const dayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Короткое описание этапа: место в сезоне и что в этот день. */
function stageText(e: EventDto, i: number, total: number): string {
  const park = parkName(e);
  if (i === 0) return `Открытие сезона: первый забег серии на 5 км — ${park}. Первая медаль-луч в будущую звезду.`;
  if (i === total - 1) return `Финал сезона — ${park}. Последний луч звезды и итоги рейтинга серии.`;
  return `Этап ${i + 1} из ${total}: забег на 5 км — ${park}. Медаль-луч всем финишёрам и баллы в рейтинг сезона.`;
}

export default async function HubPage() {
  const t = siteText('ru');
  // Только этапы серии; отдельные старты — в «Других забегах» на главной.
  const events = stagesOf(((await fetchEvents()) ?? []).filter((e) => e.slug));
  const open = anyRegistrationOpen(events);

  return (
    <main className="site-wrap hub">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(hubJsonLd(events)) }} />
      <h1 className="h-title">Забеги в Астане 2027</h1>
      <p className="hub__lead">
        Серия забегов 2027 — пять стартов на 5&nbsp;км в парках Астаны, по воскресеньям с мая по сентябрь. Беги один
        этап или весь сезон: за каждый финиш — медаль-луч, после пятого лучи складываются в звезду. Баллы за время идут в{' '}
        <Link href="/reiting">рейтинг серии</Link>.
      </p>

      {events.length === 0 ? (
        <p className="hub__lead">{t.home.calendarUnavailable}</p>
      ) : (
        <ol className="hub__list">
          {events.map((e, i) => (
            <li key={e.id} className="hub-stage">
              <span className="race__label">{i === events.length - 1 && events.length > 1 ? t.home.finalLabel : t.home.stageLabel(e.stageNumber ?? i + 1)}</span>
              <h2 className="hub-stage__title">
                <a href={`/starty/${e.slug}`}>{parkName(e)}</a>
              </h2>
              <p className="hub-stage__when">
                {dayFmt.format(new Date(e.date)).replace(/^./, (c) => c.toUpperCase())}, старт в {timeFmt.format(new Date(e.date))} · {e.distance}
              </p>
              <p className="hub-stage__text">{stageText(e, i, events.length)}</p>
              <a className="hub-stage__more" href={`/starty/${e.slug}`}>
                Программа, трасса и регистрация →
              </a>
            </li>
          ))}
        </ol>
      )}

      <section className="hub__how">
        <h2 className="hub-stage__title">Как участвовать</h2>
        <ul>
          <li>Регистрация — в Telegram, оплата — через Kaspi.</li>
          <li>{t.race.ageText} Участникам 16–17 лет нужно <a href={docPath('parentConsent', 'ru')}>согласие родителя</a>.</li>
          <li>Контрольное время — {t.race.facts.cutoffValue}: успеть можно и шагом.</li>
          <li>
            Остались вопросы — <Link href="/voprosy">частые вопросы</Link> или <a href={botChatLink('ask')}>напиши нам в Telegram</a>.
          </li>
        </ul>
        <a className="site-btn site-btn--brand site-btn--lg" href={botChatLink(open ? undefined : 'notify')}>
          {open ? t.home.registerCta : t.home.notifyCta}
        </a>
      </section>
    </main>
  );
}
