'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const SCAN_LINES = [
  'A fatal exception 0x404 has occurred at 0x00C5:NAVIGATION.SYS in module ROUTER.SYS',
  'The requested route was not registered in the application manifest.',
  'This page is an anomalous use of sortOfRemoteNG.',
  '',
  '* Press any key to return to the workspace.',
  '* Press CTRL+ALT+DEL to restart the session.',
  '* If the problem persists, contact your remote operations administrator.',
];

export default function NotFound() {
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    setNow(new Date().toISOString());
    const handler = () => {
      window.location.href = '/';
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('mousedown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('mousedown', handler);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0000aa',
        color: '#ffffff',
        fontFamily: 'Consolas, "Lucida Console", monospace',
        fontSize: 16,
        lineHeight: 1.45,
        padding: '6vh 8vw',
        overflow: 'hidden',
        zIndex: 99999,
        userSelect: 'none',
      }}
      role="alertdialog"
      aria-label="Critical failure: route not found"
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div
          style={{
            background: '#ffffff',
            color: '#0000aa',
            display: 'inline-block',
            padding: '2px 14px',
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 32,
            fontSize: 18,
          }}
        >
          sortOfRemoteNG
        </div>

        <p style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 600 }}>
          A critical failure has occurred and the route could not be located.
        </p>

        <p style={{ margin: '0 0 16px' }}>
          The current session has been navigated to a destination that is not part
          of the application. This usually indicates a stale link, a deep-link
          mismatch, or an anomalous attempt to reach an internal surface that does
          not exist.
        </p>

        <pre
          style={{
            background: 'transparent',
            color: '#ffffff',
            margin: '0 0 32px',
            padding: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
          }}
        >
{SCAN_LINES.join('\n')}
        </pre>

        <div style={{ marginBottom: 24 }}>
          <span style={{ marginRight: 16 }}>STOP: 0x00000404</span>
          <span style={{ marginRight: 16 }}>ROUTE_NOT_PRESENT</span>
          <span>{now}</span>
        </div>

        <Link
          href="/"
          style={{
            color: '#ffff55',
            textDecoration: 'underline',
            fontWeight: 600,
          }}
        >
          [ Return to workspace ]
        </Link>
      </div>

      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 12,
          textAlign: 'center',
          color: '#ffffff',
          opacity: 0.7,
          fontSize: 12,
        }}
      >
        Press any key to continue _
      </div>
    </div>
  );
}
