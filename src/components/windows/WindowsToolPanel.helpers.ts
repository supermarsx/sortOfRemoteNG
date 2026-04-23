import {
  Activity, ClipboardList, Cog, Cpu, FileText,
  HardDrive, Monitor, Terminal,
} from 'lucide-react';
import type { ConnectionSession } from '../../types/connection/connection';

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
