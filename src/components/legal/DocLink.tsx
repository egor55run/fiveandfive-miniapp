import type { MouseEvent, ReactNode } from 'react';
import { LEGAL_DOCS, type LegalDocKey } from '../../lib/legal';
import { openExternalPage } from '../../lib/telegram';

/**
 * Ссылка на оферту или политику из Mini App. Внутри Telegram открывает
 * документ встроенным браузером (приложение и введённые в форму данные
 * остаются на месте), в обычном браузере — новой вкладкой.
 */
function DocLink({
  doc,
  className,
  children,
}: {
  doc: LegalDocKey;
  className?: string;
  children: ReactNode;
}) {
  const { path } = LEGAL_DOCS[doc];
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Ссылка стоит внутри строки с галочкой: нажатие на неё не должно
    // заодно ставить или снимать галочку.
    e.stopPropagation();
    if (openExternalPage(path)) e.preventDefault();
  };
  return (
    <a className={className} href={path} target="_blank" rel="noreferrer" onClick={onClick}>
      {children}
    </a>
  );
}

export default DocLink;
