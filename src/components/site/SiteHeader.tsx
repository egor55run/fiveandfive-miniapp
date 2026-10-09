import type { Lang } from '../../lib/legal';
import { botChatLink } from '../../site/data';
import { sitePath, siteText } from '../../site/i18n';

export default function SiteHeader({ lang }: { lang: Lang }) {
  const t = siteText(lang);
  return (
    <header className="site-header">
      <div className="site-wrap site-header__row">
        <a className="site-logo" href={sitePath('/', lang)}>
          {t.brand}
        </a>
        <nav className="site-nav" aria-label={t.nav.races}>
          <a href={`${sitePath('/', lang)}#starty`}>{t.nav.races}</a>
          <a href={sitePath('/oferta', lang)}>{t.nav.documents}</a>
        </nav>
        <a className="site-header__bot" href={botChatLink()}>
          {t.nav.openBot}
        </a>
      </div>
    </header>
  );
}
