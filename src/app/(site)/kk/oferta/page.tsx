import type { Metadata } from 'next';
import LegalDocument from '../../../../components/legal/LegalDocument';
import { legalMeta } from '../../../../site/seo';

export const metadata: Metadata = legalMeta('oferta', 'kk');

export default function OfertaKkPage() {
  return <LegalDocument doc="oferta" lang="kk" />;
}
