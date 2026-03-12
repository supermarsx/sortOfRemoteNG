import React from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CapturedError {
  id: number;
  timestamp: string;
  error: Error;
  errorInfo: React.ErrorInfo | null;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errors: CapturedError[];
  expandedIds: Set<number>;
  copied: boolean;
  confirmAction: string | null; // which destructive action is pending confirmation
}

// ─── Constants ──────────────────────────────────────────────────────────────

const APP_NAME = 'sortOfRemoteNG';
const STOP_CODE = 'FRONTEND_CRITICAL_FAILURE';

// ─── Theme reader ───────────────────────────────────────────────────────────

/** Try to read CSS custom properties from the live document.  Returns null
 *  values when the theme system is broken (which is likely during a crash). */
function readTheme(): {
  bg: string; bgAlt: string; surface: string; text: string; textDim: string;
  border: string; primary: string; error: string; warning: string;
  mono: string; sans: string;
} | null {
  try {
    const s = getComputedStyle(document.body);
    const get = (v: string) => s.getPropertyValue(v).trim();
    const bg = get('--color-background');
    const text = get('--color-text');
    // If core vars are empty the theme system is dead
    if (!bg || !text) return null;
    return {
      bg,
      bgAlt: get('--color-surface') || bg,
      surface: get('--color-surface') || '#1f2937',
      text,
      textDim: get('--color-textMuted') || get('--color-textSecondary') || 'rgba(255,255,255,0.6)',
      border: get('--color-border') || '#374151',
      primary: get('--color-primary') || '#3b82f6',
      error: get('--color-error') || '#ef4444',
      warning: get('--color-warning') || '#f59e0b',
      mono: 'Consolas, "Courier New", monospace',
      sans: '"Segoe UI", system-ui, -apple-system, sans-serif',
    };
  } catch {
    return null;
  }
}

/** Classic BSOD fallback when the theme system is broken. */
const FALLBACK_THEME = {
  bg: '#0078d4',
  bgAlt: '#005a9e',
  surface: 'rgba(0,0,0,0.2)',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.65)',
  border: 'rgba(255,255,255,0.2)',
  primary: '#ffffff',
  error: '#fca5a5',
  warning: '#fcd34d',
  mono: 'Consolas, "Courier New", monospace',
  sans: '"Segoe UI", system-ui, -apple-system, sans-serif',
};

// ─── Component ──────────────────────────────────────────────────────────────

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  private nextId = 0;

  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = {
      hasError: false,
      errors: [],
      expandedIds: new Set(),
      copied: false,
      confirmAction: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[BSOD] ErrorBoundary caught a fatal error:', error, errorInfo);
    this.setState((prev) => ({
      errors: [
        ...prev.errors,
        {
          id: this.nextId++,
          timestamp: new Date().toISOString(),
          error,
          errorInfo,
        },
      ],
    }));
  }

  // ── Accordion ─────────────────────────────────────────────────────

  private toggleExpand = (id: number) => {
    this.setState((prev) => {
      const next = new Set(prev.expandedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedIds: next };
    });
  };

  private expandAll = () => {
    this.setState((prev) => ({
      expandedIds: new Set(prev.errors.map((e) => e.id)),
    }));
  };

  private collapseAll = () => {
    this.setState({ expandedIds: new Set() });
  };

  // ── Recovery actions ──────────────────────────────────────────────

  private handleRestart = () => {
    window.location.reload();
  };

  private handleCloseAllTabs = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('close_all_windows').catch(() => {});
    } catch { /* ignore */ }
    window.location.reload();
  };

  private handleQuitApp = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  private handleClearCacheAndRestart = () => {
    if (this.state.confirmAction !== 'clear-cache') {
      this.setState({ confirmAction: 'clear-cache' });
      return;
    }
    try {
      sessionStorage.clear();
      // Clear caches API
      caches?.keys?.().then((names) => names.forEach((n) => caches.delete(n)));
    } catch { /* best effort */ }
    window.location.reload();
  };

  private handleClearAllDataAndRestart = async () => {
    if (this.state.confirmAction !== 'clear-all') {
      this.setState({ confirmAction: 'clear-all' });
      return;
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
      const dbs = await indexedDB.databases?.() ?? [];
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      caches?.keys?.().then((names) => names.forEach((n) => caches.delete(n)));
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clear_app_data').catch(() => {});
    } catch { /* best effort */ }
    window.location.reload();
  };

  private handleFactoryReset = async () => {
    if (this.state.confirmAction !== 'factory-reset') {
      this.setState({ confirmAction: 'factory-reset' });
      return;
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
      const dbs = await indexedDB.databases?.() ?? [];
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      caches?.keys?.().then((names) => names.forEach((n) => caches.delete(n)));
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('factory_reset').catch(() => {});
      await invoke('clear_app_data').catch(() => {});
    } catch { /* best effort */ }
    window.location.reload();
  };

  private cancelConfirm = () => {
    this.setState({ confirmAction: null });
  };

  private handleCopyReport = async () => {
    const report = this.buildFullReport();
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2500);
  };

  private handleOpenDevtools = () => {
    try {
      // Tauri 2 webview devtools
      (window as any).__TAURI_INTERNALS__?.invoke('plugin:window|internal_toggle_devtools');
    } catch { /* ignore */ }
  };

  // ── Report builder ────────────────────────────────────────────────

  private buildFullReport(): string {
    const { errors } = this.state;
    const ts = new Date().toISOString();
    const sections = [
      `── ${APP_NAME} Crash Report ──`,
      `Generated: ${ts}`,
      `Stop code: ${STOP_CODE}`,
      `Errors captured: ${errors.length}`,
      ``,
    ];

    for (let i = 0; i < errors.length; i++) {
      const e = errors[i];
      sections.push(
        `━━ Error ${i + 1} of ${errors.length} ━━`,
        `Time: ${e.timestamp}`,
        `Type: ${e.error.name}`,
        `Message: ${e.error.message}`,
        ``,
        `Stack Trace:`,
        e.error.stack ?? '(none)',
        ``,
      );
      if (e.errorInfo?.componentStack) {
        sections.push(
          `Component Stack:`,
          e.errorInfo.componentStack,
          ``,
        );
      }
    }

    sections.push(
      `── Environment ──`,
      `User Agent: ${navigator.userAgent}`,
      `URL: ${window.location.href}`,
      `Viewport: ${window.innerWidth}×${window.innerHeight}`,
      `Platform: ${navigator.platform}`,
      `Language: ${navigator.language}`,
    );

    return sections.join('\n');
  }

  // ── Render ────────────────────────────────────────────────────────

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = readTheme() ?? FALLBACK_THEME;
    const isFallback = !readTheme();
    const { errors, expandedIds, copied, confirmAction } = this.state;
    const latestError = errors[errors.length - 1];

    return (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 2147483647,
          background: isFallback
            ? `linear-gradient(170deg, ${t.bg} 0%, ${t.bgAlt} 100%)`
            : t.bg,
          color: t.text,
          fontFamily: t.sans,
          overflow: 'auto',
          animation: 'bsod-fade-in 0.5s ease-out',
        }}
      >
        {/* Scanlines */}
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
        }} />

        {/* Main content */}
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 960, margin: '0 auto', padding: '60px 48px 48px' }}>

          {/* Emoticon */}
          <div style={{ fontSize: 110, fontWeight: 100, lineHeight: 1, marginBottom: 28, letterSpacing: -4 }}>:(</div>

          {/* Title */}
          <h1 style={{ fontSize: 26, fontWeight: 300, lineHeight: 1.3, margin: '0 0 12px' }}>
            Your app ran into a problem and needs to restart.
          </h1>
          <p style={{ fontSize: 15, fontWeight: 300, color: t.textDim, margin: '0 0 28px', lineHeight: 1.5 }}>
            {errors.length === 1
              ? 'An unrecoverable error occurred in the frontend. You can try the recovery options below.'
              : `${errors.length} errors were captured. Expand each to view details.`}
          </p>

          {/* Stop code card */}
          <div style={{
            background: t.surface, borderRadius: 8, padding: '14px 18px',
            marginBottom: 20, border: `1px solid ${t.border}`,
            fontFamily: t.mono, fontSize: 13,
          }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: t.textDim, marginBottom: 4 }}>
              Stop code
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{STOP_CODE}</div>
            <div style={{ color: t.textDim, wordBreak: 'break-word', lineHeight: 1.4 }}>
              {latestError?.error.name}: {latestError?.error.message ?? 'Unknown error'}
            </div>
          </div>

          {/* Error accordion */}
          <div style={{ marginBottom: 24 }}>
            {/* Controls */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                Captured errors ({errors.length})
              </span>
              {errors.length > 1 && (
                <>
                  <button onClick={this.expandAll} style={btnLink(t)}>Expand all</button>
                  <button onClick={this.collapseAll} style={btnLink(t)}>Collapse all</button>
                </>
              )}
            </div>

            {/* Accordion items */}
            {errors.map((e, idx) => {
              const open = expandedIds.has(e.id);
              return (
                <div key={e.id} style={{
                  border: `1px solid ${t.border}`,
                  borderRadius: 6,
                  marginBottom: 6,
                  overflow: 'hidden',
                  background: t.surface,
                }}>
                  {/* Header */}
                  <button
                    onClick={() => this.toggleExpand(e.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', textAlign: 'left',
                      background: 'none', border: 'none', color: t.text,
                      padding: '10px 14px', cursor: 'pointer',
                      fontFamily: t.sans, fontSize: 13,
                    }}
                  >
                    <span style={{
                      display: 'inline-block', transition: 'transform 0.2s ease',
                      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                      fontSize: 11,
                    }}>▶</span>
                    <span style={{ fontWeight: 600, color: t.error }}>
                      {e.error.name}
                    </span>
                    <span style={{ color: t.textDim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.error.message}
                    </span>
                    <span style={{ fontSize: 11, color: t.textDim, flexShrink: 0 }}>
                      #{idx + 1} &middot; {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                  </button>

                  {/* Collapsible body */}
                  <div style={{
                    maxHeight: open ? 600 : 0,
                    opacity: open ? 1 : 0,
                    overflow: open ? 'auto' : 'hidden',
                    transition: 'max-height 0.3s ease, opacity 0.25s ease',
                    padding: open ? '0 14px 14px' : '0 14px',
                  }}>
                    {/* Stack trace */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={stackLabel(t)}>Stack Trace</div>
                      <pre style={stackPre(t)}>{e.error.stack || '(empty)'}</pre>
                    </div>

                    {/* Component stack */}
                    {e.errorInfo?.componentStack && (
                      <div>
                        <div style={stackLabel(t)}>Component Stack</div>
                        <pre style={stackPre(t)}>{e.errorInfo.componentStack}</pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Recovery actions ────────────────────────────────────────── */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recovery options</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <button onClick={this.handleRestart} style={btnPrimary(t)}>
              Restart frontend
            </button>
            <button onClick={this.handleCloseAllTabs} style={btnSecondary(t)}>
              Close all tabs &amp; restart
            </button>
            <button onClick={this.handleCopyReport} style={btnSecondary(t)}>
              {copied ? '✓ Copied!' : 'Copy crash report'}
            </button>
            <button onClick={this.handleOpenDevtools} style={btnSecondary(t)}>
              Open DevTools
            </button>
          </div>

          {/* Destructive section */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: t.warning }}>
            Destructive options
          </div>

          {/* Confirmation alert */}
          {confirmAction && (
            <div style={{
              background: `${t.error}20`,
              border: `1px solid ${t.error}60`,
              borderRadius: 6, padding: '12px 16px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: 20 }}>⚠</span>
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
                {confirmAction === 'clear-cache' && (
                  <><strong>Clear session cache?</strong> This will clear session storage and browser caches. Your settings and connections will be preserved.</>
                )}
                {confirmAction === 'clear-all' && (
                  <><strong>Clear ALL app data?</strong> This will delete all settings, saved connections, credentials, and cached data. This cannot be undone.</>
                )}
                {confirmAction === 'factory-reset' && (
                  <><strong>Factory reset?</strong> This will wipe everything — all data, settings, and backend state — and restore the app to its initial state. This cannot be undone.</>
                )}
              </div>
              <button onClick={this.cancelConfirm} style={btnSecondary(t)}>Cancel</button>
              <button
                onClick={
                  confirmAction === 'clear-cache'
                    ? this.handleClearCacheAndRestart
                    : confirmAction === 'clear-all'
                      ? this.handleClearAllDataAndRestart
                      : this.handleFactoryReset
                }
                style={btnDanger(t)}
              >
                Confirm &amp; restart
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            <button
              onClick={this.handleClearCacheAndRestart}
              style={confirmAction === 'clear-cache' ? btnDangerActive(t) : btnDanger(t)}
            >
              Clear cache &amp; restart
            </button>
            <button
              onClick={this.handleClearAllDataAndRestart}
              style={confirmAction === 'clear-all' ? btnDangerActive(t) : btnDanger(t)}
            >
              Clear all app data &amp; restart
            </button>
            <button
              onClick={this.handleFactoryReset}
              style={confirmAction === 'factory-reset' ? btnDangerActive(t) : btnDanger(t)}
            >
              Factory reset
            </button>
            <button onClick={this.handleQuitApp} style={btnDanger(t)}>
              Quit app
            </button>
          </div>

          {/* Footer */}
          <div style={{
            fontSize: 12, color: t.textDim,
            borderTop: `1px solid ${t.border}`, paddingTop: 14,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{APP_NAME}</span>
            <span>{new Date().toLocaleString()}</span>
          </div>
        </div>

        {/* Inline animations — no external CSS dependency */}
        <style>{`
          @keyframes bsod-fade-in {
            from { opacity: 0; transform: translateY(24px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }
}

// ─── Style helpers ──────────────────────────────────────────────────────────
// Inline styles only — must work even if the app's CSS is broken.

type Theme = ReturnType<typeof readTheme> & object;

function btnPrimary(t: Theme): React.CSSProperties {
  return {
    background: t.primary, color: t.bg, border: 'none',
    padding: '9px 18px', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  };
}

function btnSecondary(t: Theme): React.CSSProperties {
  return {
    background: 'transparent', color: t.text,
    border: `1px solid ${t.border}`,
    padding: '9px 18px', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, fontFamily: 'inherit',
  };
}

function btnDanger(t: Theme): React.CSSProperties {
  return {
    background: `${t.error}18`, color: t.error,
    border: `1px solid ${t.error}40`,
    padding: '9px 18px', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, fontFamily: 'inherit',
  };
}

function btnDangerActive(t: Theme): React.CSSProperties {
  return {
    background: `${t.error}40`, color: t.text,
    border: `1px solid ${t.error}80`,
    padding: '9px 18px', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  };
}

function btnLink(t: Theme): React.CSSProperties {
  return {
    background: 'none', border: 'none', color: t.primary,
    cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
    padding: '2px 4px', textDecoration: 'underline',
  };
}

function stackLabel(t: Theme): React.CSSProperties {
  return {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5,
    color: t.textDim, marginBottom: 4,
  };
}

function stackPre(t: Theme): React.CSSProperties {
  return {
    margin: 0, fontFamily: t.mono, fontSize: 12, lineHeight: 1.6,
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    color: t.textDim, background: `${t.bg}80`,
    padding: '8px 10px', borderRadius: 4,
  };
}

export default ErrorBoundary;
