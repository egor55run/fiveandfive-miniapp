import type { Metadata } from 'next';
import LegalDocument from '../../../../components/legal/LegalDocument';
import { LEGAL_DOCS } from '../../../../lib/legal';

export const metadata: Metadata = { title: LEGAL_DOCS.privacy.title.kk };

export default function PrivacyKkPage() {
  return <LegalDocument doc="privacy" lang="kk" />;
}
