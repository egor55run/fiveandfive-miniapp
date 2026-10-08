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

const FILES: Record<LegalDocumentKind, string> = {
  OFERTA: 'oferta.md',
  PRIVACY: 'privacy.md',
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
  for (const kind of Object.keys(FILES) as LegalDocumentKind[]) {
    // CRLF → LF: редакция не должна зависеть от того, на какой ОС лежит файл.
    const content = readFileSync(path.join(legalDir(), FILES[kind]), 'utf8').replace(/\r\n/g, '\n');
    const version = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const edition = editionOf(content);
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
 * Записать согласия участника с обоими документами — в той же транзакции, что
 * и регистрация/абонемент: регистрации без записанного согласия быть не должно.
 */
export async function recordConsents(
  tx: Prisma.TransactionClient,
  target: { userId: number; registrationId?: number; seasonPassId?: number },
): Promise<void> {
  const docs = currentDocuments();
  await tx.consent.createMany({
    data: (Object.keys(docs) as LegalDocumentKind[]).map((kind) => ({
      userId: target.userId,
      documentId: docs[kind].id,
      registrationId: target.registrationId ?? null,
      seasonPassId: target.seasonPassId ?? null,
    })),
  });
}
