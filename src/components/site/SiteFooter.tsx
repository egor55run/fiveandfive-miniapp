import type { Lang } from '../../lib/legal';
import { docPath } from '../../lib/legal';
import { botChatLink, SEASON_YEAR } from '../../site/links';
import { sitePath, siteText } from '../../site/i18n';

export default function SiteFooter({ lang }: { lang: Lang }) {
  const t = siteText(lang);
  return (
    <footer className="site-footer">
      <div className="site-wrap site-footer__row">
        <span className="site-logo site-logo--sm">{t.brand}</span>
        <nav className="site-footer__links" aria-label={t.footer.documents}>
          <a href={botChatLink()}>{t.footer.telegram}</a>
          <a href={sitePath('/voprosy', lang)}>{t.footer.faq}</a>
          {/* Документы — через docPath: у них уже есть казахские версии на staging. */}
          <a href={docPath('oferta', lang)}>{t.footer.oferta}</a>
          <a href={docPath('privacy', lang)}>{t.footer.privacy}</a>
          <a href={docPath('parentConsent', lang)}>{t.footer.parentConsent}</a>
        </nav>
        <span className="site-footer__org">
          {t.footer.organizer(SEASON_YEAR)}
        </span>
      </div>
    </footer>
  );
}
