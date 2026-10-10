import type { Metadata } from 'next';
import LegalDocument from '../../../../components/legal/LegalDocument';
import { legalMeta } from '../../../../site/seo';

export const metadata: Metadata = legalMeta('parentConsent', 'kk');

export default function ParentConsentKkPage() {
  return <LegalDocument doc="parentConsent" lang="kk" />;
}
