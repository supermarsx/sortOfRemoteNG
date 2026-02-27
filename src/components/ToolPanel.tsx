import React from 'react';
import { GlobalSettings } from '../types/settings';
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

type ToolKey = keyof import('../types/settings').ToolDisplayModes;

interface ToolPanelProps {
  appSettings: GlobalSettings;
  /** Map of tool key → [isOpen, setOpen] */
  tools: Record<ToolKey, { isOpen: boolean; close: () => void }>;
}

/**
 * Renders tools configured for 'panel' display mode as a side panel.
 * Returns null if no panel-mode tool is currently open.
 */
export const ToolPanel: React.FC<ToolPanelProps> = ({ appSettings, tools }) => {
  const modes = appSettings.toolDisplayModes;
  if (!modes) return null;

  // Find the first open tool that's in panel mode
  const entries: [ToolKey, { isOpen: boolean; close: () => void }][] =
    Object.entries(tools) as [ToolKey, { isOpen: boolean; close: () => void }][];

  const active = entries.find(
    ([key, { isOpen }]) => isOpen && (modes[key] ?? 'popup') === 'panel'
  );

  if (!active) return null;

  const [toolKey, { close }] = active;

  return (
    <div className="relative flex-shrink-0 z-10 h-full overflow-hidden border-l border-gray-700" style={{ width: '480px' }}>
      {/* transform: scale(1) creates a containing block for fixed-position children,
          making tool modals render inside this panel instead of covering the viewport */}
      <div className="h-full" style={{ transform: 'scale(1)' }}>
        {toolKey === 'performanceMonitor' && <PerformanceMonitor isOpen onClose={close} />}
        {toolKey === 'actionLog' && <ActionLogViewer isOpen onClose={close} />}
        {toolKey === 'shortcutManager' && <ShortcutManagerDialog isOpen onClose={close} />}
        {toolKey === 'proxyChain' && <ProxyChainMenu isOpen onClose={close} />}
        {toolKey === 'internalProxy' && <InternalProxyManager isOpen onClose={close} />}
        {toolKey === 'wol' && <WOLQuickTool isOpen onClose={close} />}
        {toolKey === 'bulkSsh' && <BulkSSHCommander isOpen onClose={close} />}
        {toolKey === 'scriptManager' && <ScriptManager isOpen onClose={close} />}
        {toolKey === 'macroManager' && <MacroManager isOpen onClose={close} />}
        {toolKey === 'recordingManager' && <RecordingManager isOpen onClose={close} />}
      </div>
    </div>
  );
};
