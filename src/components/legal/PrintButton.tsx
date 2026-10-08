'use client';

/** Кнопка печати бланка. Что именно попадёт на лист — решают стили @media print. */
export default function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="legal__print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
