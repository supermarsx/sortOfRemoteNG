import React, { lazy, Suspense } from 'react';
import {
  Activity, ClipboardList, Cog, Cpu, FileText,
  HardDrive, Monitor, Terminal, Loader2,
} from 'lucide-react';
import { ConnectionSession } from '../../types/connection/connection';
import WinmgmtWrapper from './WinmgmtWrapper';
import type { WinmgmtContext } from './WinmgmtWrapper';

const ServicesPanel = lazy(() => import('./panels/ServicesPanel'));
const ProcessesPanel = lazy(() => import('./panels/ProcessesPanel'));
const EventLogPanel = lazy(() => import('./panels/EventLogPanel'));
const RegistryPanel = lazy(() => import('./panels/RegistryPanel'));
const ScheduledTasksPanel = lazy(() => import('./panels/ScheduledTasksPanel'));
const PerformancePanel = lazy(() => import('./panels/PerformancePanel'));
const PowerShellPanel = lazy(() => import('./panels/PowerShellPanel'));
const SystemInfoPanel = lazy(() => import('./panels/SystemInfoPanel'));

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

/** Renders the tool-specific panel for a given tool ID. */
function renderToolPanel(toolId: WindowsToolId, ctx: WinmgmtContext) {
  const fallback = (
    <div className="h-full flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-[var(--color-textMuted)]" />
    </div>
  );

  switch (toolId) {
    case 'services':
      return <Suspense fallback={fallback}><ServicesPanel ctx={ctx} /></Suspense>;
    case 'processes':
      return <Suspense fallback={fallback}><ProcessesPanel ctx={ctx} /></Suspense>;
    case 'eventlog':
      return <Suspense fallback={fallback}><EventLogPanel ctx={ctx} /></Suspense>;
    case 'registry':
      return <Suspense fallback={fallback}><RegistryPanel ctx={ctx} /></Suspense>;
    case 'tasks':
      return <Suspense fallback={fallback}><ScheduledTasksPanel ctx={ctx} /></Suspense>;
    case 'perfmon':
      return <Suspense fallback={fallback}><PerformancePanel ctx={ctx} /></Suspense>;
    case 'powershell':
      return <Suspense fallback={fallback}><PowerShellPanel ctx={ctx} /></Suspense>;
    case 'sysinfo':
      return <Suspense fallback={fallback}><SystemInfoPanel ctx={ctx} /></Suspense>;
    default:
      return null;
  }
}

interface WindowsToolPanelProps {
  session: ConnectionSession;
  onClose: () => void;
}

/** Renders the appropriate Windows management tool inside a session tab. */
const WindowsToolPanel: React.FC<WindowsToolPanelProps> = ({ session }) => {
  const toolId = getWinmgmtToolId(session.protocol);
  const tool = WINDOWS_TOOLS.find(t => t.id === toolId);

  if (!tool || !toolId) return null;

  const Icon = tool.icon;

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)]" data-testid="windows-tool-panel">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <Icon size={14} className="text-[var(--color-textSecondary)]" />
        <h2 className="text-xs font-semibold text-[var(--color-text)]">{tool.label}</h2>
        <span className="text-xs text-[var(--color-textMuted)]">·</span>
        <span className="text-xs text-[var(--color-textSecondary)] font-mono">{session.hostname}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <WinmgmtWrapper session={session}>
          {(ctx) => renderToolPanel(toolId, ctx)}
        </WinmgmtWrapper>
      </div>
    </div>
  );
};

export default WindowsToolPanel;
