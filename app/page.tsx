'use client';

import dynamic from 'next/dynamic';

const App = dynamic(() => import('../src/App'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100vw', height: '100vh', background: 'var(--color-background, #0a0a0a)' }} />
  ),
});

export default function Home() {
  return <App />;
}