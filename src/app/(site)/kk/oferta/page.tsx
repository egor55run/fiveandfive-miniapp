import type { Metadata } from 'next';
import LegalDocument from '../../../../components/legal/LegalDocument';
import { LEGAL_DOCS } from '../../../../lib/legal';

export const metadata: Metadata = { title: LEGAL_DOCS.oferta.title.kk };

export default function OfertaKkPage() {
  return <LegalDocument doc="oferta" lang="kk" />;
}
