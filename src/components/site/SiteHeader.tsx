import type { Lang } from '../../lib/legal';
import { sitePath, siteText } from '../../site/i18n';
import HeaderCta from './HeaderCta';
import SiteLogo from './SiteLogo';

/** Шапка сайта (макет главной, 2026-10-09). */
export default function SiteHeader({ lang }: { lang: Lang }) {
  const t = siteText(lang);
  const home = sitePath('/', lang);
  return (
    <header className="site-header">
      <div className="site-wrap site-header__row">
        <a className="site-logo" href={home} aria-label={t.brand}>
          <SiteLogo />
        </a>
        <nav className="site-nav" aria-label={t.nav.label}>
          <a href={`${home}#starty`}>{t.nav.races}</a>
          <a href={`${home}#zvezda`}>{t.nav.medal}</a>
          <a href={`${home}#cena`}>{t.nav.price}</a>
          <a href={sitePath('/voprosy', lang)}>{t.nav.faq}</a>
        </nav>
        <HeaderCta notify={t.nav.notify} register={t.nav.register} />
      </div>
    </header>
  );
}
