import type { Metadata } from 'next';
import LegalDocument from '../../../components/legal/LegalDocument';
import { LEGAL_DOCS } from '../../../lib/legal';

export const metadata: Metadata = { title: LEGAL_DOCS.parentConsent.title.ru };

export default function ParentConsentPage() {
  return <LegalDocument doc="parentConsent" lang="ru" />;
}
