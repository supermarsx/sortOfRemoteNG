/**
 * Frontend Reorganization Migration Script
 * 
 * Moves ~130 files into a clean domain-based folder structure,
 * rewrites all import paths across the codebase, and creates/updates
 * barrel (index.ts) files.
 *
 * Usage: node migrate.mjs
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// ================================================================
// FILE MOVE MAP (paths relative to src/)
// ================================================================
const FILE_MOVES = {
  // ── Types: Connection domain ──
  'types/connection.ts':       'types/connection/connection.ts',
  'types/credentials.ts':      'types/connection/credentials.ts',
  'types/filters.ts':          'types/connection/filters.ts',

  // ── Types: RDP ──
  'types/rdpEvents.ts':        'types/rdp/rdpEvents.ts',

  // ── Types: SSH ──
  'types/sshSettings.ts':      'types/ssh/sshSettings.ts',
  'types/sshCommandHistory.ts':'types/ssh/sshCommandHistory.ts',
  'types/sshScripts.ts':       'types/ssh/sshScripts.ts',

  // ── Types: Settings ──
  'types/settings.ts':         'types/settings/settings.ts',
  'types/backupSettings.ts':   'types/settings/backupSettings.ts',
  'types/cloudSyncSettings.ts':'types/settings/cloudSyncSettings.ts',
  'types/vpnSettings.ts':      'types/settings/vpnSettings.ts',
  'types/portable.ts':         'types/settings/portable.ts',

  // ── Types: Monitoring ──
  'types/dashboard.ts':        'types/monitoring/dashboard.ts',
  'types/serverStats.ts':      'types/monitoring/serverStats.ts',
  'types/notifications.ts':    'types/monitoring/notifications.ts',
  'types/diagnostics.ts':      'types/monitoring/diagnostics.ts',

  // ── Types: Network ──
  'types/topology.ts':         'types/network/topology.ts',
  'types/snmp.ts':             'types/network/snmp.ts',

  // ── Types: Protocols ──
  'types/docker.ts':           'types/protocols/docker.ts',
  'types/kubernetes.ts':       'types/protocols/kubernetes.ts',
  'types/jira.ts':             'types/protocols/jira.ts',
  'types/osticket.ts':         'types/protocols/osticket.ts',
  'types/budibase.ts':         'types/protocols/budibase.ts',
  'types/warpgate.ts':         'types/protocols/warpgate.ts',
  'types/whatsapp.ts':         'types/protocols/whatsapp.ts',

  // ── Types: Hardware/Infra ──
  'types/idrac.ts':            'types/hardware/idrac.ts',
  'types/ilo.ts':              'types/hardware/ilo.ts',
  'types/lenovo.ts':           'types/hardware/lenovo.ts',
  'types/supermicro.ts':       'types/hardware/supermicro.ts',
  'types/proxmox.ts':          'types/hardware/proxmox.ts',
  'types/synology.ts':         'types/hardware/synology.ts',

  // ── Types: Recording ──
  'types/macroTypes.ts':       'types/recording/macroTypes.ts',
  'types/replay.ts':           'types/recording/replay.ts',

  // ── Types: Standalone domains ──
  'types/marketplace.ts':      'types/marketplace/marketplace.ts',
  'types/scheduler.ts':        'types/scheduler/scheduler.ts',
  'types/updater.ts':          'types/updater/updater.ts',
  'types/ddns.ts':             'types/ddns/ddns.ts',
  'types/mcpServer.ts':        'types/mcp/mcpServer.ts',

  // ── Types: Security ──
  'types/gpgAgent.ts':         'types/security/gpgAgent.ts',
  'types/yubikey.ts':          'types/security/yubikey.ts',
  'types/opkssh.ts':           'types/security/opkssh.ts',

  // ── Utils: Core ──
  'utils/id.ts':               'utils/core/id.ts',
  'utils/errors.ts':           'utils/core/errors.ts',
  'utils/formatters.ts':       'utils/core/formatters.ts',
  'utils/debugLogger.ts':      'utils/core/debugLogger.ts',
  'utils/semaphore.ts':        'utils/core/semaphore.ts',
  'utils/raceWithTimeout.ts':  'utils/core/raceWithTimeout.ts',

  // ── Utils: Auth ──
  'utils/authService.ts':      'utils/auth/authService.ts',
  'utils/totpService.ts':      'utils/auth/totpService.ts',
  'utils/totpImport.ts':       'utils/auth/totpImport.ts',
  'utils/trustStore.ts':       'utils/auth/trustStore.ts',

  // ── Utils: Storage ──
  'utils/storage.ts':          'utils/storage/storage.ts',
  'utils/fileStorage.ts':      'utils/storage/fileStorage.ts',
  'utils/indexedDbService.ts':  'utils/storage/indexedDbService.ts',
  'utils/localStorageService.ts':'utils/storage/localStorageService.ts',

  // ── Utils: Connection ──
  'utils/collectionManager.ts':     'utils/connection/collectionManager.ts',
  'utils/proxyCollectionManager.ts': 'utils/connection/proxyCollectionManager.ts',
  'utils/statusChecker.ts':         'utils/connection/statusChecker.ts',

  // ── Utils: RDP ──
  'utils/rdpErrorClassifier.tsx': 'utils/rdp/rdpErrorClassifier.tsx',
  'utils/rdpFormatters.ts':      'utils/rdp/rdpFormatters.ts',
  'utils/rdpKeyboard.ts':        'utils/rdp/rdpKeyboard.ts',
  'utils/rdpSettingsMerge.ts':    'utils/rdp/rdpSettingsMerge.ts',

  // ── Utils: SSH ──
  'utils/sshLibraries.ts':       'utils/ssh/sshLibraries.ts',
  'utils/sshTunnelService.ts':   'utils/ssh/sshTunnelService.ts',
  'utils/serverStatsCommands.ts': 'utils/ssh/serverStatsCommands.ts',
  'utils/serverStatsParser.ts':  'utils/ssh/serverStatsParser.ts',

  // ── Utils: Network ──
  'utils/networkScanner.ts':     'utils/network/networkScanner.ts',
  'utils/proxyManager.ts':       'utils/network/proxyManager.ts',
  'utils/proxyOpenVPNManager.ts': 'utils/network/proxyOpenVPNManager.ts',
  'utils/wakeOnLan.ts':          'utils/network/wakeOnLan.ts',
  'utils/macVendorLookup.ts':    'utils/network/macVendorLookup.ts',

  // ── Utils: File Transfer ──
  'utils/fileTransferService.ts':  'utils/file-transfer/fileTransferService.ts',
  'utils/fileTransferAdapters.ts': 'utils/file-transfer/fileTransferAdapters.ts',

  // ── Utils: Recording/Scripts ──
  'utils/scriptEngine.ts':       'utils/recording/scriptEngine.ts',
  'utils/scriptSyntax.ts':       'utils/recording/scriptSyntax.ts',
  'utils/macroService.ts':       'utils/recording/macroService.ts',
  'utils/gifEncoder.ts':         'utils/recording/gifEncoder.ts',

  // ── Utils: Services ──
  'utils/mysqlService.ts':       'utils/services/mysqlService.ts',
  'utils/whatsappService.ts':    'utils/services/whatsappService.ts',
  'utils/backupWorker.ts':       'utils/services/backupWorker.ts',

  // ── Utils: Settings ──
  'utils/settingsManager.ts':    'utils/settings/settingsManager.ts',
  'utils/themeManager.ts':       'utils/settings/themeManager.ts',

  // ── Utils: Window ──
  'utils/dragDropManager.ts':    'utils/window/dragDropManager.ts',
  'utils/windowRepatriation.ts': 'utils/window/windowRepatriation.ts',

  // ── Utils: Discovery ──
  'utils/discoveredHostsCsv.ts': 'utils/discovery/discoveredHostsCsv.ts',
  'utils/serviceMap.ts':         'utils/discovery/serviceMap.ts',
  'utils/defaultPorts.ts':       'utils/discovery/defaultPorts.ts',

  // ── Components: Break up monitoring/ dumping ground ──
  'components/monitoring/ConnectionNotes.tsx':     'components/connection/ConnectionNotes.tsx',
  'components/monitoring/ConnectionTemplates.tsx':  'components/connection/ConnectionTemplates.tsx',
  'components/monitoring/SmartFilterManager.tsx':   'components/connection/SmartFilterManager.tsx',
  'components/monitoring/CredentialManager.tsx':    'components/security/CredentialManager.tsx',
  'components/monitoring/MarketplacePanel.tsx':     'components/marketplace/MarketplacePanel.tsx',
  'components/monitoring/PortableSettings.tsx':     'components/app/PortableSettings.tsx',
  'components/monitoring/ErrorLogBar.tsx':          'components/app/ErrorLogBar.tsx',
  'components/monitoring/RdpFileManager.tsx':       'components/rdp/RdpFileManager.tsx',
  'components/monitoring/SchedulerPanel.tsx':       'components/scheduler/SchedulerPanel.tsx',
  'components/monitoring/SessionReplayViewer.tsx':  'components/recording/SessionReplayViewer.tsx',
  'components/monitoring/TopologyVisualizer.tsx':   'components/network/TopologyVisualizer.tsx',
  'components/monitoring/UpdaterPanel.tsx':         'components/updater/UpdaterPanel.tsx',
  'components/monitoring/WindowsBackupPanel.tsx':   'components/sync/WindowsBackupPanel.tsx',

  // ── Components: shared → ui/dialogs ──
  'components/shared/ConfirmDialog.tsx': 'components/ui/dialogs/ConfirmDialog.tsx',
  'components/shared/InputDialog.tsx':   'components/ui/dialogs/InputDialog.tsx',
  'components/shared/Toast.tsx':         'components/ui/dialogs/Toast.tsx',

  // ── Components: Orphan fix ──
  'components/DdnsManager.tsx': 'components/ddns/DdnsManager.tsx',

  // ── Hooks: Redistribute from monitoring/ ──
  'hooks/monitoring/useCredentials.ts':    'hooks/security/useCredentials.ts',
  'hooks/monitoring/useFilters.ts':        'hooks/connection/useFilters.ts',
  'hooks/monitoring/useIdrac.ts':          'hooks/idrac/useIdrac.ts',
  'hooks/monitoring/useIlo.ts':            'hooks/hardware/useIlo.ts',
  'hooks/monitoring/useLenovo.ts':         'hooks/hardware/useLenovo.ts',
  'hooks/monitoring/useMarketplace.ts':    'hooks/marketplace/useMarketplace.ts',
  'hooks/monitoring/useProxmox.ts':        'hooks/proxmox/useProxmox.ts',
  'hooks/monitoring/useReplay.ts':         'hooks/recording/useReplay.ts',
  'hooks/monitoring/useScheduler.ts':      'hooks/scheduler/useScheduler.ts',
  'hooks/monitoring/useSupermicro.ts':     'hooks/hardware/useSupermicro.ts',
  'hooks/monitoring/useSynology.ts':       'hooks/synology/useSynology.ts',
  'hooks/monitoring/useTopology.ts':       'hooks/network/useTopology.ts',
  'hooks/monitoring/useUpdater.ts':        'hooks/updater/useUpdater.ts',
  'hooks/monitoring/useWindowsBackup.ts':  'hooks/sync/useWindowsBackup.ts',

  // ── Hooks: Orphan fix ──
  'hooks/useDdnsManager.ts': 'hooks/ddns/useDdnsManager.ts',
};

// ================================================================
// BARREL FILE DEFINITIONS
// ================================================================
const NEW_BARRELS = {
  // Types barrels
  'types/connection/index.ts': [
    'export * from "./connection";',
    'export * from "./credentials";',
    'export * from "./filters";',
  ],
  'types/rdp/index.ts': [
    'export * from "./rdpEvents";',
  ],
  'types/ssh/index.ts': [
    'export * from "./sshSettings";',
    'export * from "./sshCommandHistory";',
    'export * from "./sshScripts";',
  ],
  'types/settings/index.ts': [
    'export * from "./settings";',
    'export * from "./backupSettings";',
    'export * from "./cloudSyncSettings";',
    'export * from "./vpnSettings";',
    'export * from "./portable";',
  ],
  'types/monitoring/index.ts': [
    'export * from "./dashboard";',
    'export * from "./serverStats";',
    'export * from "./notifications";',
    'export * from "./diagnostics";',
  ],
  'types/network/index.ts': [
    'export * from "./topology";',
    'export * from "./snmp";',
  ],
  'types/protocols/index.ts': [
    'export * from "./docker";',
    'export * from "./kubernetes";',
    'export * from "./jira";',
    'export * from "./osticket";',
    'export * from "./budibase";',
    'export * from "./warpgate";',
    'export * from "./whatsapp";',
  ],
  'types/hardware/index.ts': [
    'export * from "./idrac";',
    'export * from "./ilo";',
    'export * from "./lenovo";',
    'export * from "./supermicro";',
    'export * from "./proxmox";',
    'export * from "./synology";',
  ],
  'types/recording/index.ts': [
    'export * from "./macroTypes";',
    'export * from "./replay";',
  ],
  'types/security/index.ts': [
    'export * from "./gpgAgent";',
    'export * from "./yubikey";',
    'export * from "./opkssh";',
  ],
  'types/marketplace/index.ts': ['export * from "./marketplace";'],
  'types/scheduler/index.ts':   ['export * from "./scheduler";'],
  'types/updater/index.ts':     ['export * from "./updater";'],
  'types/ddns/index.ts':        ['export * from "./ddns";'],
  'types/mcp/index.ts':         ['export * from "./mcpServer";'],

  // Utils barrels
  'utils/core/index.ts': [
    'export * from "./id";',
    'export * from "./errors";',
    'export * from "./formatters";',
    'export * from "./debugLogger";',
    'export * from "./semaphore";',
    'export * from "./raceWithTimeout";',
  ],
  'utils/auth/index.ts': [
    'export * from "./authService";',
    'export * from "./totpService";',
    'export * from "./totpImport";',
    'export * from "./trustStore";',
  ],
  'utils/storage/index.ts': [
    'export * from "./storage";',
    'export * from "./fileStorage";',
    'export * from "./indexedDbService";',
    'export * from "./localStorageService";',
  ],
  'utils/connection/index.ts': [
    'export * from "./collectionManager";',
    'export * from "./proxyCollectionManager";',
    'export * from "./statusChecker";',
  ],
  'utils/rdp/index.ts': [
    'export * from "./rdpErrorClassifier";',
    'export * from "./rdpFormatters";',
    'export * from "./rdpKeyboard";',
    'export * from "./rdpSettingsMerge";',
  ],
  'utils/ssh/index.ts': [
    'export * from "./sshLibraries";',
    'export * from "./sshTunnelService";',
    'export * from "./serverStatsCommands";',
    'export * from "./serverStatsParser";',
  ],
  'utils/network/index.ts': [
    'export * from "./networkScanner";',
    'export * from "./proxyManager";',
    'export * from "./proxyOpenVPNManager";',
    'export * from "./wakeOnLan";',
    'export * from "./macVendorLookup";',
  ],
  'utils/file-transfer/index.ts': [
    'export * from "./fileTransferService";',
    'export * from "./fileTransferAdapters";',
  ],
  'utils/recording/index.ts': [
    'export * from "./scriptEngine";',
    'export * from "./scriptSyntax";',
    'export * from "./macroService";',
    'export * from "./gifEncoder";',
  ],
  'utils/services/index.ts': [
    'export * from "./mysqlService";',
    'export * from "./whatsappService";',
    'export * from "./backupWorker";',
  ],
  'utils/settings/index.ts': [
    'export * from "./settingsManager";',
    'export * from "./themeManager";',
  ],
  'utils/window/index.ts': [
    'export * from "./dragDropManager";',
    'export * from "./windowRepatriation";',
  ],
  'utils/discovery/index.ts': [
    'export * from "./discoveredHostsCsv";',
    'export * from "./serviceMap";',
    'export * from "./defaultPorts";',
  ],

  // New hooks barrels
  'hooks/marketplace/index.ts': ['export * from "./useMarketplace";'],
  'hooks/scheduler/index.ts':   ['export * from "./useScheduler";'],
  'hooks/updater/index.ts':     ['export * from "./useUpdater";'],
  'hooks/hardware/index.ts': [
    'export * from "./useIlo";',
    'export * from "./useLenovo";',
    'export * from "./useSupermicro";',
  ],
  'hooks/ddns/index.ts':        ['export * from "./useDdnsManager";'],

  // New component barrels
  'components/marketplace/index.ts': ['export { MarketplacePanel } from "./MarketplacePanel";'],
  'components/scheduler/index.ts':   ['export { SchedulerPanel } from "./SchedulerPanel";'],
  'components/updater/index.ts':     ['export { UpdaterPanel } from "./UpdaterPanel";'],
  'components/ddns/index.ts':        ['export { default as DdnsManager } from "./DdnsManager";'],
  'components/ui/dialogs/index.ts': [
    'export { ConfirmDialog } from "./ConfirmDialog";',
    'export type { ConfirmDialogProps } from "./ConfirmDialog";',
    'export { InputDialog } from "./InputDialog";',
    'export { Toast } from "./Toast";',
    'export type { ToastType, ToastMessage } from "./Toast";',
  ],
};

// Existing barrels to UPDATE (add new exports)
const BARREL_ADDITIONS = {
  'hooks/monitoring/index.ts': {
    add: [
      'export * from "./useDashboard";',
      'export * from "./useNotificationRules";',
    ],
  },
  'hooks/security/index.ts': {
    add:    ['export * from "./useCredentials";'],
  },
  'hooks/connection/index.ts': {
    add:    ['export * from "./useFilters";'],
  },
  'hooks/recording/index.ts': {
    add:    ['export * from "./useReplay";'],
  },
  'hooks/network/index.ts': {
    add:    ['export * from "./useTopology";'],
  },
  'hooks/sync/index.ts': {
    add:    ['export * from "./useWindowsBackup";'],
  },
};

// Barrels to CREATE for existing + newly moved hooks
const HOOKS_BARRELS_CREATE = {
  'hooks/idrac/index.ts': [
    'export * from "./useIdrac";',
    'export * from "./useIdracManager";',
  ],
  'hooks/proxmox/index.ts': [
    'export * from "./useProxmox";',
    'export * from "./useProxmoxManager";',
  ],
  'hooks/synology/index.ts': [
    'export * from "./useSynology";',
    'export * from "./useSynologyManager";',
  ],
};

// ================================================================
// HELPERS
// ================================================================

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Recursively collect all .ts/.tsx files in given directories */
function findAllFiles(dirs) {
  const results = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    walkDir(dir, results);
  }
  return results;
}

function walkDir(dir, results) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'target' || entry.name === 'dist' || entry.name === '.git') continue;
      walkDir(full, results);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
}

/**
 * Resolve a relative import string to an absolute file path.
 * Returns null if it can't be resolved.
 */
function resolveImport(importerDir, importPath) {
  if (!importPath.startsWith('.')) return null;

  const base = path.resolve(importerDir, importPath);
  // Try exact file
  for (const ext of ['', '.ts', '.tsx']) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  // Try directory with index
  for (const idx of ['/index.ts', '/index.tsx']) {
    const candidate = base + idx;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Compute the new import string from a source file location to a target file location.
 */
function computeNewImportPath(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile);
  // Normalize to forward slashes
  rel = rel.split(path.sep).join('/');
  // Remove extension
  rel = rel.replace(/\.(ts|tsx)$/, '');
  // Remove /index suffix
  rel = rel.replace(/\/index$/, '');
  // Ensure starts with ./ or ../
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

// ================================================================
// MAIN MIGRATION
// ================================================================

function main() {
  console.log('=== Frontend Reorganization Migration ===\n');

  // 1. Build absolute path move map
  console.log('1. Building move map...');
  const moveMap = new Map();
  for (const [oldRel, newRel] of Object.entries(FILE_MOVES)) {
    const oldAbs = path.join(SRC, oldRel);
    const newAbs = path.join(SRC, newRel);
    if (!fs.existsSync(oldAbs)) {
      console.warn(`   WARN: Source not found, skipping: ${oldRel}`);
      continue;
    }
    moveMap.set(oldAbs, newAbs);
  }
  console.log(`   ${moveMap.size} files to move.\n`);

  // 2. Pre-scan: find all source files and resolve imports pointing to moved files
  console.log('2. Scanning imports...');
  const scanDirs = [SRC, path.join(ROOT, 'tests'), path.join(ROOT, 'app'), path.join(ROOT, 'vitest.mocks')];
  const allFiles = findAllFiles(scanDirs);
  console.log(`   Found ${allFiles.length} source files.`);

  // Map: filePath → Array<{originalImport, resolvedTarget, quote}>
  const fileImportMap = new Map();
  let totalImports = 0;

  const importPatterns = [
    /from\s+(['"])(\.\.?\/[^'"]+)\1/g,
    /vi\.mock\s*\(\s*(['"])(\.\.?\/[^'"]+)\1/g,
    /jest\.mock\s*\(\s*(['"])(\.\.?\/[^'"]+)\1/g,
    /require\s*\(\s*(['"])(\.\.?\/[^'"]+)\1/g,
  ];

  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const imports = [];

    for (const pattern of importPatterns) {
      // Reset lastIndex for each file
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const quote = match[1];
        const importPath = match[2];
        const resolved = resolveImport(path.dirname(filePath), importPath);
        if (resolved && moveMap.has(resolved)) {
          imports.push({
            originalImport: importPath,
            resolvedTarget: resolved,
            quote,
          });
        }
      }
    }

    if (imports.length > 0) {
      fileImportMap.set(filePath, imports);
      totalImports += imports.length;
    }
  }
  console.log(`   Found ${totalImports} imports to rewrite across ${fileImportMap.size} files.\n`);

  // 3. Create new directories
  console.log('3. Creating directories...');
  const newDirs = new Set();
  for (const newPath of moveMap.values()) {
    newDirs.add(path.dirname(newPath));
  }
  for (const dir of newDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  console.log(`   Created ${newDirs.size} directories.\n`);

  // 4. Move files
  console.log('4. Moving files...');
  let moved = 0;
  for (const [oldPath, newPath] of moveMap) {
    try {
      fs.renameSync(oldPath, newPath);
      moved++;
    } catch (err) {
      console.error(`   ERROR moving ${oldPath} → ${newPath}: ${err.message}`);
    }
  }
  console.log(`   Moved ${moved} files.\n`);

  // 5. Rewrite imports
  console.log('5. Rewriting imports...');
  let rewritten = 0;
  for (const [filePath, imports] of fileImportMap) {
    // The file itself might have been moved
    const currentPath = moveMap.get(filePath) || filePath;
    let content = fs.readFileSync(currentPath, 'utf-8');
    let modified = false;

    for (const imp of imports) {
      const newTargetPath = moveMap.get(imp.resolvedTarget);
      if (!newTargetPath) continue;

      const newImport = computeNewImportPath(currentPath, newTargetPath);

      // Build a regex to find and replace this specific import path
      // We match the import path in the exact context (from/mock/require)
      const escaped = escapeRegex(imp.originalImport);
      const regex = new RegExp(`(${escapeRegex(imp.quote)})${escaped}(${escapeRegex(imp.quote)})`, 'g');
      const before = content;
      content = content.replace(regex, `$1${newImport}$2`);
      if (content !== before) {
        modified = true;
        rewritten++;
      }
    }

    if (modified) {
      fs.writeFileSync(currentPath, content, 'utf-8');
    }
  }
  console.log(`   Rewrote ${rewritten} import paths.\n`);

  // 6. Create new barrel files
  console.log('6. Creating barrel files...');
  let barrelCount = 0;
  for (const [relPath, lines] of Object.entries(NEW_BARRELS)) {
    const absPath = path.join(SRC, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, lines.join('\n') + '\n', 'utf-8');
    barrelCount++;
  }
  for (const [relPath, lines] of Object.entries(HOOKS_BARRELS_CREATE)) {
    const absPath = path.join(SRC, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, lines.join('\n') + '\n', 'utf-8');
    barrelCount++;
  }
  console.log(`   Created ${barrelCount} barrel files.\n`);

  // 7. Update existing barrel files
  console.log('7. Updating existing barrel files...');
  for (const [relPath, updates] of Object.entries(BARREL_ADDITIONS)) {
    const absPath = path.join(SRC, relPath);
    if (!fs.existsSync(absPath)) {
      console.warn(`   WARN: Barrel not found: ${relPath}`);
      continue;
    }
    let content = fs.readFileSync(absPath, 'utf-8');
    if (updates.add) {
      for (const line of updates.add) {
        if (!content.includes(line)) {
          content = content.trimEnd() + '\n' + line + '\n';
        }
      }
    }
    fs.writeFileSync(absPath, content, 'utf-8');
  }
  console.log('   Done.\n');

  // 8. Clean up empty directories
  console.log('8. Cleaning up empty directories...');
  const dirsToCheck = [
    path.join(SRC, 'components/shared'),
    path.join(SRC, 'components/monitoring'), // might have only remaining files
  ];
  for (const dir of dirsToCheck) {
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        console.log(`   Removed empty: ${path.relative(ROOT, dir)}`);
      }
    }
  }

  console.log('\n=== Migration complete! ===');
  console.log(`\nSummary:`);
  console.log(`  Files moved:      ${moved}`);
  console.log(`  Imports rewritten: ${rewritten}`);
  console.log(`  Barrels created:  ${barrelCount}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Run: npm run lint`);
  console.log(`  2. Run: npm test -- --run`);
  console.log(`  3. Check for any remaining issues`);
}

main();
