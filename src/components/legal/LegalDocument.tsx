import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { LEGAL_DOCS, type LegalDocKey } from '../../lib/legal';

/**
 * Страница юридического документа. Серверный компонент: markdown читается и
 * превращается в HTML при сборке — страница статическая, в браузер не уходит
 * ни парсер, ни сам файл. Текст наш (legal/*.md), поэтому вставка HTML как есть
 * безопасна.
 */
export default async function LegalDocument({ doc }: { doc: LegalDocKey }) {
  const file = path.join(process.cwd(), 'legal', LEGAL_DOCS[doc].file);
  const markdown = await readFile(file, 'utf8');
  const html = await marked.parse(markdown, { gfm: true });

  return (
    <main className="legal">
      <span className="legal__brand">5&amp;5</span>
      <article className="legal__body" dangerouslySetInnerHTML={{ __html: html }} />
      <nav className="legal__nav" aria-label="Документы">
        {Object.entries(LEGAL_DOCS)
          .filter(([key]) => key !== doc)
          .map(([key, d]) => (
            <a key={key} href={d.path}>
              {d.title}
            </a>
          ))}
      </nav>
    </main>
  );
}
