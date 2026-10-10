import type { Metadata } from 'next';
import LegalDocument from '../../../../components/legal/LegalDocument';
import { legalMeta } from '../../../../site/seo';

export const metadata: Metadata = legalMeta('privacy', 'kk');

export default function PrivacyKkPage() {
  return <LegalDocument doc="privacy" lang="kk" />;
}
