'use client';

import dynamic from 'next/dynamic';

const CriticalErrorScreen = dynamic(
  () =>
    import('../src/components/app/CriticalErrorScreen').then(
      (m) => m.CriticalErrorScreen,
    ),
  { ssr: false },
);

export default function NotFound() {
  const detail = [
    'The requested route is not registered in the application manifest.',
    '',
    'This is an anomalous use of sortOfRemoteNG. The workspace did not',
    'navigate here intentionally — the URL is either stale, hand-edited,',
    'or pointing at an internal surface that does not exist.',
    '',
    typeof window !== 'undefined' ? `URL: ${window.location.href}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <CriticalErrorScreen
      title="ROUTE_NOT_PRESENT (0x00000404)"
      detail={detail}
    />
  );
}
