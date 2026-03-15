import React from 'react';
import {
  Activity, ClipboardList, Cog, Cpu, FileText,
  HardDrive, Monitor, Terminal,
} from 'lucide-react';
import { ConnectionSession } from '../../types/connection/connection';

/** Windows management tool identifiers. */
export const WINDOWS_TOOLS = [
  { id: 'services', label: 'Services', icon: Cog },
  { id: 'processes', label: 'Processes', icon: Cpu },
  { id: 'eventlog', label: 'Event Viewer', icon: FileText },
  { id: 'registry', label: 'Registry', icon: HardDrive },
  { id: 'tasks', label: 'Scheduled Tasks', icon: ClipboardList },
  { id: 'perfmon', label: 'Performance', icon: Activity },
  { id: 'powershell', label: 'PowerShell', icon: Terminal },
  { id: 'sysinfo', label: 'System Info', icon: Monitor },
] as const;

export type WindowsToolId = typeof WINDOWS_TOOLS[number]['id'];

export const WINMGMT_PROTOCOL_PREFIX = 'winmgmt:';

export const isWinmgmtProtocol = (protocol: string): boolean =>
  protocol.startsWith(WINMGMT_PROTOCOL_PREFIX);

export const getWinmgmtToolId = (protocol: string): WindowsToolId | null => {
  if (!isWinmgmtProtocol(protocol)) return null;
  return protocol.slice(WINMGMT_PROTOCOL_PREFIX.length) as WindowsToolId;
};

export const getWinmgmtProtocol = (toolId: WindowsToolId): string =>
  `${WINMGMT_PROTOCOL_PREFIX}${toolId}`;

export const getWindowsToolLabel = (toolId: WindowsToolId): string =>
  WINDOWS_TOOLS.find(t => t.id === toolId)?.label ?? toolId;

export const getWindowsToolIcon = (toolId: WindowsToolId) =>
  WINDOWS_TOOLS.find(t => t.id === toolId)?.icon ?? Monitor;

/** Create a session for a Windows management tool targeting a specific connection. */
export function createWinmgmtSession(
  toolId: WindowsToolId,
  connectionId: string,
  connectionName: string,
  hostname: string,
): ConnectionSession {
  return {
    id: `winmgmt-${toolId}-${connectionId}-${Date.now()}`,
    connectionId,
    name: `${connectionName} — ${getWindowsToolLabel(toolId)}`,
    status: 'connected',
    startTime: new Date(),
    protocol: getWinmgmtProtocol(toolId),
    hostname,
  };
}

interface WindowsToolPanelProps {
  session: ConnectionSession;
  onClose: () => void;
}

/** Renders the appropriate Windows management tool inside a session tab. */
const WindowsToolPanel: React.FC<WindowsToolPanelProps> = ({ session, onClose }) => {
  const toolId = getWinmgmtToolId(session.protocol);
  const tool = WINDOWS_TOOLS.find(t => t.id === toolId);

  if (!tool) return null;

  const Icon = tool.icon;

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <Icon size={16} className="text-[var(--color-textSecondary)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{tool.label}</h2>
        <span className="text-xs text-[var(--color-textMuted)]">·</span>
        <span className="text-xs text-[var(--color-textSecondary)]">{session.hostname}</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Icon size={48} className="text-[var(--color-textMuted)] mx-auto" />
          <p className="text-sm text-[var(--color-textSecondary)]">
            {tool.label} for <span className="font-mono">{session.hostname}</span>
          </p>
          <p className="text-xs text-[var(--color-textMuted)]">
            Remote Windows management tools are coming soon.
          </p>
        </div>
      </div>
    </div>
  );
};

export default WindowsToolPanel;
