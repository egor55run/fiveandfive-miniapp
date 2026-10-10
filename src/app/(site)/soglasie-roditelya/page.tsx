import type { Metadata } from 'next';
import LegalDocument from '../../../components/legal/LegalDocument';
import { legalMeta } from '../../../site/seo';

export const metadata: Metadata = legalMeta('parentConsent', 'ru');

export default function ParentConsentPage() {
  return <LegalDocument doc="parentConsent" lang="ru" />;
}
