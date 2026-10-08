import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LegalDocumentKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Оферта и политика обработки ПДн, под которыми участник ставит галочки.
 *
 * Тексты лежат в legal/*.md в корне репозитория — из них же собираются
 * страницы /oferta и /privacy на сайте, поэтому показанный и записанный текст
 * не расходятся. Редакция документа = sha256 его текста: любая правка текста —
 * новая редакция. При запуске сервер сохраняет текущую редакцию в
 * legal_documents (если её там ещё нет), а каждое согласие ссылается на неё.
 */

/** Документы-файлы: их тексты показываются на сайте. */
const FILES: Partial<Record<LegalDocumentKind, string>> = {
  OFERTA: 'oferta.md',
  PRIVACY: 'privacy.md',
};

/**
 * Обещание участника 16–17 лет. «Документ» — сам текст галочки: если он
 * изменится, это новая редакция, и видно, какое именно обещание дал человек.
 * Тот же текст — в приложении (src/lib/eligibility.ts).
 */
export const PARENTAL_CONSENT_TEXT =
  'Принесу письменное согласие родителя или законного представителя на выдачу стартового пакета';

const STATEMENTS: Partial<Record<LegalDocumentKind, string>> = {
  PARENTAL_CONSENT: PARENTAL_CONSENT_TEXT,
};

/** backend/dist/lib и backend/src/lib — на одной глубине от корня репозитория. */
function legalDir(): string {
  return process.env.LEGAL_DIR?.trim() || path.resolve(__dirname, '../../../legal');
}

type CurrentDocument = { id: number; version: string; edition: string };
let current: Record<LegalDocumentKind, CurrentDocument> | null = null;

/** «Редакция от [дата публикации].» → «[дата публикации]» (без экранирования markdown). */
function editionOf(text: string): string {
  const m = text.match(/Редакция от\s+(.+?)\.(?:\s|$)/);
  return m ? m[1].replace(/\\(.)/g, '$1').trim() : 'не указана';
}

/**
 * Прочитать документы и сохранить их текущие редакции. Вызывается при запуске
 * сервера; без документов регистрация не работает (см. currentDocuments) —
 * записать согласие было бы не на что.
 */
export async function loadLegalDocuments(): Promise<Record<LegalDocumentKind, CurrentDocument>> {
  const loaded = {} as Record<LegalDocumentKind, CurrentDocument>;
  const sources: [LegalDocumentKind, string][] = [
    ...(Object.entries(FILES) as [LegalDocumentKind, string][]).map(
      ([kind, file]): [LegalDocumentKind, string] => [
        kind,
        // CRLF → LF: редакция не должна зависеть от того, на какой ОС лежит файл.
        readFileSync(path.join(legalDir(), file), 'utf8').replace(/\r\n/g, '\n'),
      ],
    ),
    ...(Object.entries(STATEMENTS) as [LegalDocumentKind, string][]),
  ];
  for (const [kind, content] of sources) {
    const version = createHash('sha256').update(content).digest('hex').slice(0, 16);
    // У галочки нет строки «Редакция от …» — её редакция только хеш.
    const edition = FILES[kind] ? editionOf(content) : 'текст галочки';
    const doc = await prisma.legalDocument.upsert({
      where: { kind_version: { kind, version } },
      create: { kind, version, edition, content },
      update: {},
    });
    loaded[kind] = { id: doc.id, version, edition };
  }
  current = loaded;
  return loaded;
}

function currentDocuments(): Record<LegalDocumentKind, CurrentDocument> {
  if (!current) throw new Error('Документы legal/*.md не загружены — согласие записать нельзя');
  return current;
}

/**
 * Записать согласия участника — оферта и политика всегда, обещание родителя —
 * если участнику на день старта 16–17. В той же транзакции, что и
 * регистрация/абонемент: регистрации без записанного согласия быть не должно.
 */
export async function recordConsents(
  tx: Prisma.TransactionClient,
  target: { userId: number; registrationId?: number; seasonPassId?: number },
  options: { parentalConsent: boolean },
): Promise<void> {
  const docs = currentDocuments();
  const kinds: LegalDocumentKind[] = ['OFERTA', 'PRIVACY'];
  if (options.parentalConsent) kinds.push('PARENTAL_CONSENT');
  await tx.consent.createMany({
    data: kinds.map((kind) => ({
      userId: target.userId,
      documentId: docs[kind].id,
      registrationId: target.registrationId ?? null,
      seasonPassId: target.seasonPassId ?? null,
    })),
  });
}
