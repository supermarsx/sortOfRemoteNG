import React, { useCallback } from 'react';
import { useConnections } from '../../contexts/useConnections';
import { useSettings } from '../../contexts/SettingsContext';
import {
  WINDOWS_TOOLS,
  createWinmgmtSession,
  type WindowsToolId,
} from '../windows/WindowsToolPanel';

interface WindowsToolsBarProps {
  connectionId: string;
  connectionName: string;
  hostname: string;
  /** Per-connection override for focus behavior (undefined = use global) */
  focusOnWinmgmtTool?: boolean;
  /** Per-connection override for enabling WinRM tools (undefined = use global) */
  enableWinrmTools?: boolean;
  onActivateSession?: (sessionId: string) => void;
}

const WindowsToolsBar: React.FC<WindowsToolsBarProps> = ({
  connectionId, connectionName, hostname, focusOnWinmgmtTool, enableWinrmTools, onActivateSession,
}) => {
  const { dispatch } = useConnections();
  const { settings } = useSettings();

  // Check global + per-connection toggle
  const winrmEnabled = enableWinrmTools ?? settings.enableWinrmTools ?? true;
  if (!winrmEnabled) return null;

  const openTool = useCallback((toolId: WindowsToolId) => {
    const session = createWinmgmtSession(toolId, connectionId, connectionName, hostname);
    dispatch({ type: 'ADD_SESSION', payload: session });

    const shouldFocus = focusOnWinmgmtTool ?? !settings.openWinmgmtToolInBackground;
    if (shouldFocus && onActivateSession) {
      onActivateSession(session.id);
    }
  }, [connectionId, connectionName, hostname, dispatch, focusOnWinmgmtTool, settings.openWinmgmtToolInBackground, onActivateSession]);

  return (
    <div className="flex items-center gap-0.5 px-2 py-0.5 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
      <span className="text-[10px] font-semibold text-[var(--color-textMuted)] uppercase tracking-wider mr-1.5 select-none">
        Windows
      </span>
      {WINDOWS_TOOLS.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.id}
            onClick={() => openTool(tool.id)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
            data-tooltip={tool.label}
          >
            <Icon size={12} />
            <span className="hidden lg:inline">{tool.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default WindowsToolsBar;
