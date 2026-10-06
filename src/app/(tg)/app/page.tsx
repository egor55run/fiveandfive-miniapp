import type { Metadata } from 'next';
import MiniApp from './MiniApp';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function MiniAppPage() {
  return <MiniApp />;
}
