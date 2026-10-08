import type { Metadata } from 'next';
import LegalDocument from '../../../components/legal/LegalDocument';
import { LEGAL_DOCS } from '../../../lib/legal';

export const metadata: Metadata = { title: LEGAL_DOCS.oferta.title.ru };

export default function OfertaPage() {
  return <LegalDocument doc="oferta" lang="ru" />;
}
