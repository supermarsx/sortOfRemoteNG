import React, { useState, useCallback } from "react";

/**
 * BSOD-style screen shown when the application critically fails to initialize
 * or takes longer than the allowed timeout (5 minutes).
 *
 * Uses only inline styles so it renders even when the CSS/theme system is broken.
 */

const MONO = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const BG = "#0a0e27";
const BG_ALT = "#0f1535";
const SURFACE = "#141a3a";
const BORDER = "#1e2650";
const TEXT = "#e2e8f0";
const TEXT_DIM = "#8892b0";
const ACCENT = "#3b82f6";
const RED = "#ef4444";
const AMBER = "#f59e0b";

/** localStorage key used by useAppLifecycle to skip guardrails on next boot. */
export const SAFE_MODE_KEY = "mremote-safe-mode";

const btnBase: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: SANS,
  border: `1px solid ${BORDER}`,
  background: SURFACE,
  color: TEXT,
};

interface CriticalErrorScreenProps {
  title: string;
  detail: string;
}

export const CriticalErrorScreen: React.FC<CriticalErrorScreenProps> = ({
  title,
  detail,
}) => {
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showGuardrails, setShowGuardrails] = useState(false);

  const handleCopy = useCallback(() => {
    const report = [
      `sortOfRemoteNG — Critical Error Report`,
      `========================================`,
      `Stop code: ${title}`,
      `Time: ${new Date().toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
      ``,
      detail,
    ].join("\n");
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [title, detail]);

  const handleRestart = useCallback(() => {
    window.location.reload();
  }, []);

  const handleClearData = useCallback(async () => {
    try {
      const dbs = await indexedDB.databases?.();
      if (dbs) {
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
      }
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }, []);

  /** Set safe-mode flag and restart — guardrails skipped for next launch only. */
  const handleSafeModeOnce = useCallback(() => {
    localStorage.setItem(SAFE_MODE_KEY, "once");
    window.location.reload();
  }, []);

  /** Set safe-mode flag permanently — guardrails disabled until user re-enables. */
  const handleSafeModePermanent = useCallback(() => {
    localStorage.setItem(SAFE_MODE_KEY, "permanent");
    window.location.reload();
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: `linear-gradient(170deg, ${BG} 0%, ${BG_ALT} 100%)`,
        color: TEXT,
        fontFamily: SANS,
        overflow: "auto",
      }}
    >
      {/* Scanlines overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          maxWidth: 820,
          margin: "0 auto",
          padding: "80px 48px 48px",
        }}
      >
        {/* Emoticon */}
        <div
          style={{
            fontSize: 120,
            fontWeight: 100,
            lineHeight: 1,
            marginBottom: 32,
            letterSpacing: -4,
          }}
        >
          :(
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 28,
            fontWeight: 300,
            lineHeight: 1.3,
            margin: "0 0 12px",
          }}
        >
          sortOfRemoteNG ran into a critical problem and cannot start.
        </h1>
        <p
          style={{
            fontSize: 15,
            fontWeight: 300,
            color: TEXT_DIM,
            margin: "0 0 32px",
            lineHeight: 1.6,
          }}
        >
          The application was unable to complete its initialization. This is
          usually caused by corrupted settings, a locked database, or a missing
          system dependency.
        </p>

        {/* Stop code card */}
        <div
          style={{
            background: SURFACE,
            borderRadius: 8,
            padding: "16px 20px",
            marginBottom: 24,
            border: `1px solid ${BORDER}`,
            fontFamily: MONO,
            fontSize: 13,
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: TEXT_DIM,
              marginBottom: 4,
            }}
          >
            Stop code
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              marginBottom: 8,
              color: RED,
            }}
          >
            {title}
          </div>

          {/* Expandable detail */}
          <button
            onClick={() => setShowDetail(!showDetail)}
            style={{
              background: "none",
              border: "none",
              color: ACCENT,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 12,
              padding: 0,
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            {showDetail ? "Hide details" : "Show details"}
          </button>
          {showDetail && (
            <pre
              style={{
                marginTop: 12,
                padding: 14,
                background: BG,
                borderRadius: 6,
                border: `1px solid ${BORDER}`,
                fontSize: 12,
                lineHeight: 1.5,
                color: TEXT_DIM,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              {detail}
            </pre>
          )}
        </div>

        {/* Recovery actions */}
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <button
            onClick={handleRestart}
            style={{ ...btnBase, background: ACCENT, color: "#fff", fontWeight: 600, border: "none" }}
          >
            Restart Application
          </button>
          <button onClick={handleClearData} style={btnBase}>
            Clear Data &amp; Restart
          </button>
          <button onClick={handleCopy} style={btnBase}>
            {copied ? "Copied!" : "Copy Error Report"}
          </button>
        </div>

        {/* Guardrails section */}
        <div style={{ marginBottom: 32 }}>
          <button
            onClick={() => setShowGuardrails(!showGuardrails)}
            style={{
              background: "none",
              border: "none",
              color: AMBER,
              cursor: "pointer",
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 500,
              padding: 0,
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            {showGuardrails ? "Hide safe mode options" : "Safe mode options..."}
          </button>

          {showGuardrails && (
            <div
              style={{
                marginTop: 14,
                padding: 16,
                background: SURFACE,
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  color: TEXT_DIM,
                  margin: "0 0 14px",
                  lineHeight: 1.6,
                }}
              >
                Safe mode skips startup guardrails that may be causing the failure:
                single-window enforcement, unexpected-close detection, auto-open
                last collection, session reconnection, and auto-benchmarking.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  onClick={handleSafeModeOnce}
                  style={{ ...btnBase, borderColor: AMBER, color: AMBER }}
                >
                  Safe Mode (this launch only)
                </button>
                <button
                  onClick={handleSafeModePermanent}
                  style={{ ...btnBase, borderColor: RED, color: RED }}
                >
                  Disable Guardrails Permanently
                </button>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: TEXT_DIM,
                  margin: "10px 0 0",
                  lineHeight: 1.5,
                  fontFamily: MONO,
                }}
              >
                Permanent mode can be reverted from Settings &gt; Startup after
                the application loads successfully.
              </p>
            </div>
          )}
        </div>

        {/* Timestamp & system info */}
        <div
          style={{
            fontSize: 11,
            color: TEXT_DIM,
            fontFamily: MONO,
            lineHeight: 1.8,
          }}
        >
          <div>Time: {new Date().toISOString()}</div>
          <div>Platform: {navigator.userAgent.split(" ").slice(-3).join(" ")}</div>
          <div>Version: v0.1.0</div>
        </div>
      </div>
    </div>
  );
};

export default CriticalErrorScreen;
