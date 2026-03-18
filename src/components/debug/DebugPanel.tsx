import React from 'react';
import {
  FlaskConical,
  Search,
  ChevronDown,
  Play,
  Trash2,
  Monitor,
  AlertCircle,
  Database,
  Palette,
  X,
  Zap,
  Skull,
  RotateCcw,
} from 'lucide-react';
import { ConnectionSession } from '../../types/connection/connection';
import { ConnectionAction } from '../../contexts/ConnectionContextTypes';
import { useDebugPanel, type DebugAction } from '../../hooks/debug/useDebugPanel';
import { Modal } from '../ui/overlays/Modal';

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  sessions: <Monitor size={13} />,
  errors: <AlertCircle size={13} />,
  state: <Database size={13} />,
  ui: <Palette size={13} />,
};

const CATEGORY_ACCENT: Record<string, string> = {
  sessions: 'var(--color-primary)',
  errors: 'var(--color-error)',
  state: 'var(--color-warning)',
  ui: 'var(--color-accent, var(--color-primary))',
};

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
  dispatch: React.Dispatch<ConnectionAction>;
  setActiveSessionId: (id: string) => void;
  sessions: ConnectionSession[];
  handleOpenDevtools: () => void;
}

const ActionRow: React.FC<{ action: DebugAction; accent: string }> = ({ action, accent }) => (
  <button
    onClick={action.action}
    className="w-full flex items-start gap-3 px-3 py-2 rounded-md text-left group transition-colors"
    style={{ background: 'transparent' }}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--color-border) 35%, transparent)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <span
      className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center mt-0.5 transition-colors"
      style={{
        background: 'color-mix(in srgb, var(--color-border) 50%, transparent)',
        color: 'var(--color-textMuted)',
      }}
    >
      <Play size={10} />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-[13px] text-[var(--color-text)] font-medium leading-snug">{action.label}</p>
      <p className="text-[11px] text-[var(--color-textMuted)] leading-snug truncate">{action.description}</p>
    </div>
  </button>
);

export const DebugPanel: React.FC<DebugPanelProps> = ({
  isOpen,
  onClose,
  dispatch,
  setActiveSessionId,
  sessions,
  handleOpenDevtools,
}) => {
  const mgr = useDebugPanel({ dispatch, setActiveSessionId, sessions, handleOpenDevtools });

  return (
    <Modal isOpen={isOpen} onClose={onClose} panelClassName="max-w-2xl w-full">
      <div
        className="sor-modal-wrapper flex flex-col overflow-hidden"
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.75rem',
          maxHeight: '80vh',
          boxShadow: '0 24px 64px rgb(0 0 0 / 0.4)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-3.5 flex-shrink-0"
          style={{
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--color-accent, var(--color-primary)) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent, var(--color-primary)) 25%, transparent)',
            }}
          >
            <FlaskConical size={16} style={{ color: 'var(--color-accent, var(--color-primary))' }} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Debug Panel</h2>
            <p className="text-[11px] text-[var(--color-textMuted)]">
              {mgr.sessionCount} sessions ({mgr.debugSessionCount} debug)
            </p>
          </div>
          <button onClick={onClose} className="sor-icon-btn-sm">
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-textMuted)' }} />
            <input
              type="text"
              value={mgr.filter}
              onChange={(e) => mgr.setFilter(e.target.value)}
              placeholder="Filter actions… (e.g. rdp, error, ssh)"
              className="sor-search-input"
              style={{ paddingLeft: '2rem', fontSize: '0.8125rem' }}
            />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="px-5 py-2.5 flex flex-wrap gap-2 flex-shrink-0" style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
          <button
            className="sor-btn sor-btn-sm sor-btn-primary"
            onClick={() => {
              const a = mgr.categories.find((c) => c.key === 'errors')?.actions.find((a) => a.id === 'spawn-all-rdp-errors');
              a?.action();
            }}
          >
            <Zap size={11} /> All RDP Errors
          </button>
          <button
            className="sor-btn sor-btn-sm sor-btn-accent"
            onClick={() => {
              const a = mgr.categories.find((c) => c.key === 'sessions')?.actions.find((a) => a.id === 'spawn-all-protocols-connected');
              a?.action();
            }}
          >
            <Monitor size={11} /> All Protocols
          </button>
          <button
            className="sor-btn sor-btn-sm sor-btn-warning"
            onClick={() => {
              const a = mgr.categories.find((c) => c.key === 'sessions')?.actions.find((a) => a.id === 'spawn-mixed-stress');
              a?.action();
            }}
          >
            <Zap size={11} /> Stress 50
          </button>
          <button
            className="sor-btn sor-btn-sm sor-btn-danger"
            onClick={() => {
              const a = mgr.categories.find((c) => c.key === 'ui')?.actions.find((a) => a.id === 'trigger-bsod');
              a?.action();
            }}
          >
            <Skull size={11} /> BSOD
          </button>
          {mgr.debugSessionCount > 0 && (
            <button
              className="sor-btn sor-btn-sm sor-btn-danger"
              onClick={() => {
                const a = mgr.categories.find((c) => c.key === 'state')?.actions.find((a) => a.id === 'close-all-debug');
                a?.action();
              }}
            >
              <Trash2 size={11} /> Clean Debug ({mgr.debugSessionCount})
            </button>
          )}
          <button
            className="sor-btn sor-btn-sm sor-btn-warning"
            onClick={() => window.location.reload()}
          >
            <RotateCcw size={11} /> Restart Frontend
          </button>
        </div>

        {/* Accordion body */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {mgr.categories.map((cat) => {
            if (cat.actions.length === 0) return null;
            const isOpen = mgr.expandedCategory === cat.key;
            const accent = CATEGORY_ACCENT[cat.key];
            return (
              <div
                key={cat.key}
                className="rounded-lg overflow-hidden"
                style={{
                  border: isOpen ? '1px solid var(--color-border)' : '1px solid transparent',
                  background: isOpen
                    ? 'color-mix(in srgb, var(--color-border) 20%, transparent)'
                    : 'color-mix(in srgb, var(--color-border) 30%, transparent)',
                }}
              >
                <button
                  onClick={() => mgr.toggleCategory(cat.key)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors"
                  onMouseEnter={(e) => { if (!isOpen) e.currentTarget.parentElement!.style.background = 'color-mix(in srgb, var(--color-border) 45%, transparent)'; }}
                  onMouseLeave={(e) => { if (!isOpen) e.currentTarget.parentElement!.style.background = 'color-mix(in srgb, var(--color-border) 30%, transparent)'; }}
                >
                  <span
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `color-mix(in srgb, ${accent} 15%, transparent)`,
                      color: accent,
                    }}
                  >
                    {CATEGORY_ICON[cat.key]}
                  </span>
                  <span className="flex-1 text-[13px] font-medium text-[var(--color-text)]">{cat.label}</span>
                  <span
                    className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-full"
                    style={{
                      background: 'color-mix(in srgb, var(--color-border) 60%, transparent)',
                      color: 'var(--color-textMuted)',
                    }}
                  >
                    {cat.actions.length}
                  </span>
                  <span
                    style={{
                      color: 'var(--color-textMuted)',
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                      transition: 'transform 150ms',
                    }}
                  >
                    <ChevronDown size={14} />
                  </span>
                </button>
                {isOpen && (
                  <div className="pb-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
                    {cat.actions.map((action) => (
                      <ActionRow key={action.id} action={action} accent={accent} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
