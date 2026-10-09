import type { Metadata } from 'next';
import { Fragment, type ReactNode } from 'react';
import type { Lang } from '../../../lib/legal';
import { faqItems, faqPlainText } from '../../../site/faq';
import { botChatLink } from '../../../site/links';
import { siteText } from '../../../site/i18n';

const lang: Lang = 'ru';

export const metadata: Metadata = {
  title: 'Вопросы',
  description:
    'Частые вопросы о забегах 5&5: возраст, регистрация и оплата через Kaspi, возврат, передача слота, перенос из-за погоды, что взять с собой.',
};

/** «текст [ссылка](/адрес) текст» → текст со ссылками. */
function withLinks(text: string): ReactNode {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    return m ? (
      <a key={i} href={m[2]}>
        {m[1]}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

export default function FaqPage() {
  const t = siteText(lang);
  const items = faqItems(lang);
  // Разметка FAQPage для поисковиков — тот же текст, что на странице.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: faqPlainText(item.a) },
    })),
  };

  return (
    <main className="site-wrap faq">
      <h1 className="h-title">{t.faq.title}</h1>
      <p className="faq__lead">
        {t.faq.lead} <a href={botChatLink()}>{t.faq.ask}</a>
      </p>
      <div className="faq__list">
        {items.map((item) => (
          <details className="faq-item" key={item.q}>
            <summary className="faq-item__q">{item.q}</summary>
            <div className="faq-item__a">
              {item.a.map((block, i) =>
                typeof block === 'string' ? (
                  <p key={i}>{withLinks(block)}</p>
                ) : (
                  <ul key={i}>
                    {block.list.map((line) => (
                      <li key={line}>{withLinks(line)}</li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </main>
  );
}
