/**
 * What warms when. Code chunks for lazily loaded panels are prefetched on user
 * intent (hover/focus on the entry that opens them) at priority 1 and, for the
 * most used ones, once after startup at priority 3. Everything goes through the
 * preload scheduler: deferred while the user is typing, a terminal/RDP session
 * is busy or the window is hidden, never prompts, never unlocks.
 *
 * Only CODE is warmed here. First data reads are deliberately not preloaded:
 * session lists are live state (stale rows would corrupt disconnect detection),
 * manager panels need a connected device, and vault/document data is owned by
 * utils/preload (unlock-gated, cleared on lock). Nothing here touches secrets.
 *
 * Keep the import thunks in sync with the `dynamic()` targets in
 * components/app/{ToolPanel,AppDialogs}.tsx so the later mount finds the chunk.
 */
import { prefetchChunk, preloadOnIntent } from "./preloadScheduler";

export const PANEL_CHUNKS = {
  settings: () => import("../../components/SettingsDialog"),
  quickConnect: () => import("../../components/connection/QuickConnect"),
  sessionManager: () =>
    import("../../components/session/sessionManager/SessionManager"),
  proxyMenu: () => import("../../components/network/ProxyChainMenu"),
  importExport: () => import("../../components/ImportExport"),
  networkDiscovery: () => import("../../components/network/NetworkDiscovery"),
  networkToolkit: () =>
    import("../../components/network/toolkit/NetworkToolkit"),
  wol: () => import("../../components/network/WOLQuickTool"),
  bulkSsh: () => import("../../components/ssh/BulkSSHCommander"),
  serverStats: () => import("../../components/ssh/ServerStatsPanel"),
  mcpServer: () => import("../../components/ssh/McpServerPanel"),
  scriptManager: () => import("../../components/recording/ScriptManager"),
  macroManager: () => import("../../components/recording/MacroManager"),
  recordingManager: () => import("../../components/recording/RecordingManager"),
  tagManager: () => import("../../components/connection/TagManagerDialog"),
  tabGroupManager: () => import("../../components/session/TabGroupManager"),
  performanceMonitor: () =>
    import("../../components/monitoring/PerformanceMonitor"),
  trustCenter: () => import("../../components/security/TrustCenterTab"),
  hardwareKeys: () => import("../../components/security/HardwareKeysTab"),
  iconExplorer: () => import("../../components/icons/IconExplorerTab"),
} as const satisfies Record<string, () => Promise<unknown>>;

export type PanelId = keyof typeof PANEL_CHUNKS;

/** Opened most often: warmed once when the app is idle after startup. */
export const IDLE_WARMUP_PANELS: readonly PanelId[] = [
  "settings",
  "sessionManager",
  "quickConnect",
  "importExport",
  "proxyMenu",
];

const intentHandlers = new Map<PanelId, ReturnType<typeof preloadOnIntent>>();

/**
 * Hover/focus handlers for the button that opens `panel` (80 ms debounce,
 * priority 1). One stable object per panel, so spreading it never re-renders.
 */
export function panelIntent(panel: PanelId) {
  let handlers = intentHandlers.get(panel);
  if (!handlers) {
    handlers = preloadOnIntent(`chunk:panel:${panel}`, {
      priority: 1,
      run: PANEL_CHUNKS[panel],
    });
    intentHandlers.set(panel, handlers);
  }
  return handlers;
}

/** Prefetch the most used panels at idle priority; returns a cancel function. */
export function warmPanelsWhenIdle(
  panels: readonly PanelId[] = IDLE_WARMUP_PANELS,
): () => void {
  const cancels = panels.map((panel) =>
    prefetchChunk(`panel:${panel}`, PANEL_CHUNKS[panel], 3),
  );
  return () => cancels.forEach((cancel) => cancel());
}
