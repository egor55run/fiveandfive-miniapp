import type { Metadata } from 'next';
import LegalDocument from '../../../components/legal/LegalDocument';
import { legalMeta } from '../../../site/seo';

export const metadata: Metadata = legalMeta('oferta', 'ru');

export default function OfertaPage() {
  return <LegalDocument doc="oferta" lang="ru" />;
}
