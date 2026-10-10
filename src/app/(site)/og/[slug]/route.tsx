import { fetchEventBySlug, fetchEvents } from '../../../../site/data';
import { siteText } from '../../../../site/i18n';
import { ogImage } from '../../../../site/og';

const TZ = 'Asia/Almaty';

/**
 * Превью старта — /og/<slug>: этап, название, дата и время, парк. Данные из
 * базы при запросе; мессенджеры кешируют картинку сами, поэтому храним час.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [event, events] = await Promise.all([fetchEventBySlug(slug), fetchEvents()]);
  if (!event) return new Response('Not found', { status: 404 });

  const t = siteText('ru');
  const list = events ?? [];
  const index = list.findIndex((e) => e.id === event.id);
  const kicker =
    index < 0 ? undefined : list.length > 1 && index === list.length - 1 ? t.home.finalLabel : t.home.stageLabel(index + 1);
  const date = new Intl.DateTimeFormat(t.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
    .format(new Date(event.date))
    .replace(/^./, (c) => c.toUpperCase());
  const time = new Intl.DateTimeFormat(t.locale, { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(event.date));
  const year = new Intl.DateTimeFormat(t.locale, { year: 'numeric', timeZone: TZ }).format(new Date(event.date));

  return ogImage({
    kicker,
    title: event.title,
    lines: [`${date} · ${time}`, event.location],
    band: `5 КМ · КОНТРОЛЬНОЕ ВРЕМЯ 1 ЧАС · ${year}`,
    maxAge: 3600,
  });
}
