import React from 'react';
import { ConnectionSession } from '../types/connection';
import { ToolDisplayModes } from '../types/settings';
import { PerformanceMonitor } from './PerformanceMonitor';
import { ActionLogViewer } from './ActionLogViewer';
import { ShortcutManagerDialog } from './ShortcutManagerDialog';
import { ProxyChainMenu } from './ProxyChainMenu';
import { InternalProxyManager } from './InternalProxyManager';
import { WOLQuickTool } from './WOLQuickTool';
import { BulkSSHCommander } from './BulkSSHCommander';
import { ScriptManager } from './ScriptManager';
import { MacroManager } from './MacroManager';
import { RecordingManager } from './RecordingManager';
import { generateId } from '../utils/id';

export type ToolKey = Exclude<keyof ToolDisplayModes, 'globalDefault'>;

/** Protocol prefix for tool tabs in the session system */
export const TOOL_PROTOCOL_PREFIX = 'tool:';

/** Map of tool key to display name */
export const TOOL_LABELS: Record<ToolKey, string> = {
  performanceMonitor: 'Performance Monitor',
  actionLog: 'Action Log',
  shortcutManager: 'Shortcuts',
  proxyChain: 'Proxy Chain',
  internalProxy: 'Internal Proxy',
  wol: 'Wake-on-LAN',
  bulkSsh: 'Bulk SSH',
  scriptManager: 'Script Manager',
  macroManager: 'Macros',
  recordingManager: 'Recording Manager',
};

/** Check if a protocol string is a tool tab */
export const isToolProtocol = (protocol: string): boolean =>
  protocol.startsWith(TOOL_PROTOCOL_PREFIX);

/** Extract the tool key from a tool protocol string */
export const getToolKeyFromProtocol = (protocol: string): ToolKey | null => {
  if (!protocol.startsWith(TOOL_PROTOCOL_PREFIX)) return null;
  return protocol.slice(TOOL_PROTOCOL_PREFIX.length) as ToolKey;
};

/** Build the protocol string for a tool */
export const getToolProtocol = (toolKey: ToolKey): string =>
  `${TOOL_PROTOCOL_PREFIX}${toolKey}`;

/** Create a ConnectionSession for a tool tab */
export const createToolSession = (toolKey: ToolKey): ConnectionSession => ({
  id: generateId(),
  connectionId: `tool-${toolKey}`,
  name: TOOL_LABELS[toolKey],
  status: 'connected',
  startTime: new Date(),
  protocol: getToolProtocol(toolKey),
  hostname: '',
});

interface ToolTabViewerProps {
  session: ConnectionSession;
  onClose: () => void;
}

/**
 * Renders the appropriate tool component inside a session tab.
 * Used by SessionViewer when the session protocol starts with "tool:".
 */
export const ToolTabViewer: React.FC<ToolTabViewerProps> = ({ session, onClose }) => {
  const toolKey = getToolKeyFromProtocol(session.protocol);
  if (!toolKey) return null;

  // Tools render as modal dialogs (fixed inset-0 + backdrop). Inside a tab,
  // the .tool-tab-embedded class strips the backdrop, makes the outer wrapper
  // fill the tab, and forces the inner dialog to fill it too.
  return (
    <div className="tool-tab-embedded h-full relative overflow-hidden">
      {toolKey === 'performanceMonitor' && <PerformanceMonitor isOpen onClose={onClose} />}
      {toolKey === 'actionLog' && <ActionLogViewer isOpen onClose={onClose} />}
      {toolKey === 'shortcutManager' && <ShortcutManagerDialog isOpen onClose={onClose} />}
      {toolKey === 'proxyChain' && <ProxyChainMenu isOpen onClose={onClose} />}
      {toolKey === 'internalProxy' && <InternalProxyManager isOpen onClose={onClose} />}
      {toolKey === 'wol' && <WOLQuickTool isOpen onClose={onClose} />}
      {toolKey === 'bulkSsh' && <BulkSSHCommander isOpen onClose={onClose} />}
      {toolKey === 'scriptManager' && <ScriptManager isOpen onClose={onClose} />}
      {toolKey === 'macroManager' && <MacroManager isOpen onClose={onClose} />}
      {toolKey === 'recordingManager' && <RecordingManager isOpen onClose={onClose} />}
    </div>
  );
};
