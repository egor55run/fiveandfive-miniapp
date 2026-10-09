import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { docPath, KK_ENABLED, LEGAL_DOCS, type Lang, type LegalDocKey } from '../../lib/legal';
import PrintButton from './PrintButton';

/**
 * Страница юридического документа. Серверный компонент: markdown читается и
 * превращается в HTML при сборке — страница статическая, в браузер не уходит
 * ни парсер, ни сам файл. Текст наш (legal/*.md), поэтому вставка HTML как есть
 * безопасна.
 */
export default async function LegalDocument({
  doc,
  lang = 'ru',
}: {
  doc: LegalDocKey;
  lang?: Lang;
}) {
  // Казахские версии — только где включены (staging), см. KK_ENABLED.
  if (lang === 'kk' && !KK_ENABLED) notFound();

  const info = LEGAL_DOCS[doc];
  const file = path.join(process.cwd(), 'legal', info.file[lang]);
  const markdown = await readFile(file, 'utf8');
  const html = await marked.parse(markdown, { gfm: true });
  const printable = 'printable' in info && info.printable;

  return (
    <main className={`legal${printable ? ' legal--printable' : ''}`}>
      {/* Логотип и навигация — в шапке сайта; здесь только переключатель языка. */}
      {KK_ENABLED && (
        <header className="legal__top">
          <nav className="legal__lang" aria-label="Язык / Тіл">
            <a href={docPath(doc, 'ru')} aria-current={lang === 'ru' ? 'page' : undefined}>
              Рус
            </a>
            <a href={docPath(doc, 'kk')} aria-current={lang === 'kk' ? 'page' : undefined}>
              Қаз
            </a>
          </nav>
        </header>
      )}

      {printable && (
        <PrintButton label={lang === 'kk' ? 'Басып шығару' : 'Распечатать'} />
      )}

      <article
        className="legal__body"
        lang={lang === 'kk' ? 'kk' : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <nav className="legal__nav" aria-label={lang === 'kk' ? 'Құжаттар' : 'Документы'}>
        {(Object.keys(LEGAL_DOCS) as LegalDocKey[])
          .filter((key) => key !== doc)
          .map((key) => (
            <a key={key} href={docPath(key, lang)}>
              {LEGAL_DOCS[key].title[lang]}
            </a>
          ))}
      </nav>
    </main>
  );
}
