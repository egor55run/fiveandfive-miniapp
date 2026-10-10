import type { Metadata } from 'next';
import LegalDocument from '../../../components/legal/LegalDocument';
import { legalMeta } from '../../../site/seo';

export const metadata: Metadata = legalMeta('privacy', 'ru');

export default function PrivacyPage() {
  return <LegalDocument doc="privacy" lang="ru" />;
}
