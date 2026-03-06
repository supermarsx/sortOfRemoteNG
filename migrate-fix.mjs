/**
 * Fix Pass: Update relative imports inside moved files that point to NON-moved targets.
 * When a file moves to a different depth, its relative paths to existing files change.
 * Also catches any remaining test mock paths.
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// Same move map as migrate.mjs
const FILE_MOVES = {
  'types/connection.ts':       'types/connection/connection.ts',
  'types/credentials.ts':      'types/connection/credentials.ts',
  'types/filters.ts':          'types/connection/filters.ts',
  'types/rdpEvents.ts':        'types/rdp/rdpEvents.ts',
  'types/sshSettings.ts':      'types/ssh/sshSettings.ts',
  'types/sshCommandHistory.ts':'types/ssh/sshCommandHistory.ts',
  'types/sshScripts.ts':       'types/ssh/sshScripts.ts',
  'types/settings.ts':         'types/settings/settings.ts',
  'types/backupSettings.ts':   'types/settings/backupSettings.ts',
  'types/cloudSyncSettings.ts':'types/settings/cloudSyncSettings.ts',
  'types/vpnSettings.ts':      'types/settings/vpnSettings.ts',
  'types/portable.ts':         'types/settings/portable.ts',
  'types/dashboard.ts':        'types/monitoring/dashboard.ts',
  'types/serverStats.ts':      'types/monitoring/serverStats.ts',
  'types/notifications.ts':    'types/monitoring/notifications.ts',
  'types/diagnostics.ts':      'types/monitoring/diagnostics.ts',
  'types/topology.ts':         'types/network/topology.ts',
  'types/snmp.ts':             'types/network/snmp.ts',
  'types/docker.ts':           'types/protocols/docker.ts',
  'types/kubernetes.ts':       'types/protocols/kubernetes.ts',
  'types/jira.ts':             'types/protocols/jira.ts',
  'types/osticket.ts':         'types/protocols/osticket.ts',
  'types/budibase.ts':         'types/protocols/budibase.ts',
  'types/warpgate.ts':         'types/protocols/warpgate.ts',
  'types/whatsapp.ts':         'types/protocols/whatsapp.ts',
  'types/idrac.ts':            'types/hardware/idrac.ts',
  'types/ilo.ts':              'types/hardware/ilo.ts',
  'types/lenovo.ts':           'types/hardware/lenovo.ts',
  'types/supermicro.ts':       'types/hardware/supermicro.ts',
  'types/proxmox.ts':          'types/hardware/proxmox.ts',
  'types/synology.ts':         'types/hardware/synology.ts',
  'types/macroTypes.ts':       'types/recording/macroTypes.ts',
  'types/replay.ts':           'types/recording/replay.ts',
  'types/marketplace.ts':      'types/marketplace/marketplace.ts',
  'types/scheduler.ts':        'types/scheduler/scheduler.ts',
  'types/updater.ts':          'types/updater/updater.ts',
  'types/ddns.ts':             'types/ddns/ddns.ts',
  'types/mcpServer.ts':        'types/mcp/mcpServer.ts',
  'types/gpgAgent.ts':         'types/security/gpgAgent.ts',
  'types/yubikey.ts':          'types/security/yubikey.ts',
  'types/opkssh.ts':           'types/security/opkssh.ts',
  'utils/id.ts':               'utils/core/id.ts',
  'utils/errors.ts':           'utils/core/errors.ts',
  'utils/formatters.ts':       'utils/core/formatters.ts',
  'utils/debugLogger.ts':      'utils/core/debugLogger.ts',
  'utils/semaphore.ts':        'utils/core/semaphore.ts',
  'utils/raceWithTimeout.ts':  'utils/core/raceWithTimeout.ts',
  'utils/authService.ts':      'utils/auth/authService.ts',
  'utils/totpService.ts':      'utils/auth/totpService.ts',
  'utils/totpImport.ts':       'utils/auth/totpImport.ts',
  'utils/trustStore.ts':       'utils/auth/trustStore.ts',
  'utils/storage.ts':          'utils/storage/storage.ts',
  'utils/fileStorage.ts':      'utils/storage/fileStorage.ts',
  'utils/indexedDbService.ts':  'utils/storage/indexedDbService.ts',
  'utils/localStorageService.ts':'utils/storage/localStorageService.ts',
  'utils/collectionManager.ts':     'utils/connection/collectionManager.ts',
  'utils/proxyCollectionManager.ts': 'utils/connection/proxyCollectionManager.ts',
  'utils/statusChecker.ts':         'utils/connection/statusChecker.ts',
  'utils/rdpErrorClassifier.tsx': 'utils/rdp/rdpErrorClassifier.tsx',
  'utils/rdpFormatters.ts':      'utils/rdp/rdpFormatters.ts',
  'utils/rdpKeyboard.ts':        'utils/rdp/rdpKeyboard.ts',
  'utils/rdpSettingsMerge.ts':    'utils/rdp/rdpSettingsMerge.ts',
  'utils/sshLibraries.ts':       'utils/ssh/sshLibraries.ts',
  'utils/sshTunnelService.ts':   'utils/ssh/sshTunnelService.ts',
  'utils/serverStatsCommands.ts': 'utils/ssh/serverStatsCommands.ts',
  'utils/serverStatsParser.ts':  'utils/ssh/serverStatsParser.ts',
  'utils/networkScanner.ts':     'utils/network/networkScanner.ts',
  'utils/proxyManager.ts':       'utils/network/proxyManager.ts',
  'utils/proxyOpenVPNManager.ts': 'utils/network/proxyOpenVPNManager.ts',
  'utils/wakeOnLan.ts':          'utils/network/wakeOnLan.ts',
  'utils/macVendorLookup.ts':    'utils/network/macVendorLookup.ts',
  'utils/fileTransferService.ts':  'utils/file-transfer/fileTransferService.ts',
  'utils/fileTransferAdapters.ts': 'utils/file-transfer/fileTransferAdapters.ts',
  'utils/scriptEngine.ts':       'utils/recording/scriptEngine.ts',
  'utils/scriptSyntax.ts':       'utils/recording/scriptSyntax.ts',
  'utils/macroService.ts':       'utils/recording/macroService.ts',
  'utils/gifEncoder.ts':         'utils/recording/gifEncoder.ts',
  'utils/mysqlService.ts':       'utils/services/mysqlService.ts',
  'utils/whatsappService.ts':    'utils/services/whatsappService.ts',
  'utils/backupWorker.ts':       'utils/services/backupWorker.ts',
  'utils/settingsManager.ts':    'utils/settings/settingsManager.ts',
  'utils/themeManager.ts':       'utils/settings/themeManager.ts',
  'utils/dragDropManager.ts':    'utils/window/dragDropManager.ts',
  'utils/windowRepatriation.ts': 'utils/window/windowRepatriation.ts',
  'utils/discoveredHostsCsv.ts': 'utils/discovery/discoveredHostsCsv.ts',
  'utils/serviceMap.ts':         'utils/discovery/serviceMap.ts',
  'utils/defaultPorts.ts':       'utils/discovery/defaultPorts.ts',
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
  'components/shared/ConfirmDialog.tsx': 'components/ui/dialogs/ConfirmDialog.tsx',
  'components/shared/InputDialog.tsx':   'components/ui/dialogs/InputDialog.tsx',
  'components/shared/Toast.tsx':         'components/ui/dialogs/Toast.tsx',
  'components/DdnsManager.tsx': 'components/ddns/DdnsManager.tsx',
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
  'hooks/useDdnsManager.ts': 'hooks/ddns/useDdnsManager.ts',
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Try to resolve an import from a given directory. 
 * Returns absolute path if found, null otherwise.
 */
function resolveImport(importerDir, importPath) {
  if (!importPath.startsWith('.')) return null;
  const base = path.resolve(importerDir, importPath);
  for (const ext of ['', '.ts', '.tsx', '.css']) {
    const c = base + ext;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  for (const idx of ['/index.ts', '/index.tsx']) {
    const c = base + idx;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function computeNewImportPath(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile);
  rel = rel.split(path.sep).join('/');
  rel = rel.replace(/\.(ts|tsx)$/, '');
  rel = rel.replace(/\/index$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function walkDir(dir, results) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'target', 'dist', '.git'].includes(entry.name)) continue;
      walkDir(full, results);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
}

// ================================================================
// PHASE 1: Fix imports in moved files that point to non-moved targets
// ================================================================

function fixMovedFileImports() {
  console.log('\n=== Phase 1: Fix moved files\' internal imports ===\n');

  // Build map: newAbsPath → oldAbsPath
  const reverseMap = new Map();
  for (const [oldRel, newRel] of Object.entries(FILE_MOVES)) {
    const oldAbs = path.join(SRC, oldRel);
    const newAbs = path.join(SRC, newRel);
    if (fs.existsSync(newAbs)) {
      reverseMap.set(newAbs, oldAbs);
    }
  }

  // Also build forward map for moved targets (already handled)
  const forwardMap = new Map();
  for (const [oldRel, newRel] of Object.entries(FILE_MOVES)) {
    forwardMap.set(path.join(SRC, oldRel), path.join(SRC, newRel));
  }

  let totalFixed = 0;

  for (const [newFilePath, oldFilePath] of reverseMap) {
    let content = fs.readFileSync(newFilePath, 'utf-8');
    let modified = false;

    // Find ALL relative import/mock paths
    const patterns = [
      /from\s+(['"])(\.\.?\/[^'"]+)\1/g,
      /vi\.mock\s*\(\s*(['"])(\.\.?\/[^'"]+)\1/g,
      /require\s*\(\s*(['"])(\.\.?\/[^'"]+)\1/g,
    ];

    const oldDir = path.dirname(oldFilePath);
    const newDir = path.dirname(newFilePath);

    // Skip if directory didn't change
    if (oldDir === newDir) continue;

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      const replacements = [];
      let match;

      while ((match = regex.exec(content)) !== null) {
        const quote = match[1];
        const importPath = match[2];

        // Resolve from the OLD location
        const resolvedFromOld = resolveFromDir(oldDir, importPath);
        if (!resolvedFromOld) continue;

        // If the target was also moved, it was already handled by migrate.mjs
        if (forwardMap.has(resolvedFromOld)) continue;

        // Check if the import still resolves from the NEW location
        const resolvedFromNew = resolveImport(newDir, importPath);
        if (resolvedFromNew && resolvedFromNew === resolvedFromOld) continue; // Still valid

        // Need to fix: compute correct relative path from new location to old target
        const newImportPath = computeNewImportPath(newFilePath, resolvedFromOld);

        if (newImportPath !== importPath) {
          replacements.push({ oldImport: importPath, newImport: newImportPath, quote });
        }
      }

      for (const r of replacements) {
        const escaped = escapeRegex(r.oldImport);
        const replaceRegex = new RegExp(
          `(${escapeRegex(r.quote)})${escaped}(${escapeRegex(r.quote)})`, 'g'
        );
        const before = content;
        content = content.replace(replaceRegex, `$1${r.newImport}$2`);
        if (content !== before) {
          modified = true;
          totalFixed++;
        }
      }
    }

    if (modified) {
      fs.writeFileSync(newFilePath, content, 'utf-8');
      console.log(`  Fixed: ${path.relative(ROOT, newFilePath)}`);
    }
  }

  console.log(`\n  Total import fixes in moved files: ${totalFixed}`);
}

/**
 * Resolve import from a directory that may no longer exist (the OLD location).
 * We need to figure out where the target IS now.
 */
function resolveFromDir(dir, importPath) {
  if (!importPath.startsWith('.')) return null;
  const base = path.resolve(dir, importPath);

  // Try to find the file at its current location (it might not have moved)
  for (const ext of ['', '.ts', '.tsx']) {
    const c = base + ext;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  for (const idx of ['/index.ts', '/index.tsx']) {
    const c = base + idx;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }

  return null;
}

// ================================================================
// PHASE 2: Fix remaining test file mock paths
// ================================================================

function fixTestMockPaths() {
  console.log('\n=== Phase 2: Fix test file mock & import paths ===\n');

  // Build map: oldAbs → newAbs
  const moveMap = new Map();
  for (const [oldRel, newRel] of Object.entries(FILE_MOVES)) {
    moveMap.set(path.join(SRC, oldRel), path.join(SRC, newRel));
  }

  const testDirs = [path.join(ROOT, 'tests'), path.join(SRC, 'utils', '__tests__')];
  const testFiles = [];
  for (const dir of testDirs) {
    walkDir(dir, testFiles);
  }

  let totalFixed = 0;

  for (const testFile of testFiles) {
    let content = fs.readFileSync(testFile, 'utf-8');
    let modified = false;

    // Find all relative path strings
    const allPathRegex = /(['"])(\.\.?\/[^'"]+)\1/g;
    const replacements = [];
    let match;

    while ((match = allPathRegex.exec(content)) !== null) {
      const quote = match[1];
      const importPath = match[2];

      // Try to resolve from old location (the path as-is might not resolve)
      const testDir = path.dirname(testFile);
      const base = path.resolve(testDir, importPath);

      // Check if it resolves now
      const currentResolved = resolveImport(testDir, importPath);
      if (currentResolved) continue; // Still valid, skip

      // It doesn't resolve. Try to find the moved target.
      for (const ext of ['', '.ts', '.tsx']) {
        const candidate = base + ext;
        if (moveMap.has(candidate)) {
          const newTarget = moveMap.get(candidate);
          const newImport = computeNewImportPath(testFile, newTarget);
          if (newImport !== importPath) {
            replacements.push({ oldImport: importPath, newImport, quote });
          }
          break;
        }
      }
      // Also try /index.ts
      for (const idx of ['/index.ts', '/index.tsx']) {
        const candidate = base + idx;
        if (moveMap.has(candidate)) {
          const newTarget = moveMap.get(candidate);
          const newImport = computeNewImportPath(testFile, newTarget);
          if (newImport !== importPath) {
            replacements.push({ oldImport: importPath, newImport, quote });
          }
          break;
        }
      }
    }

    for (const r of replacements) {
      const escaped = escapeRegex(r.oldImport);
      const replaceRegex = new RegExp(
        `(${escapeRegex(r.quote)})${escaped}(${escapeRegex(r.quote)})`, 'g'
      );
      const before = content;
      content = content.replace(replaceRegex, `$1${r.newImport}$2`);
      if (content !== before) {
        modified = true;
        totalFixed++;
      }
    }

    if (modified) {
      fs.writeFileSync(testFile, content, 'utf-8');
      console.log(`  Fixed: ${path.relative(ROOT, testFile)}`);
    }
  }

  console.log(`\n  Total test import fixes: ${totalFixed}`);
}

// ================================================================
// PHASE 3: Fix ALL source files with broken imports (comprehensive scan)
// ================================================================

function fixAllBrokenImports() {
  console.log('\n=== Phase 3: Comprehensive broken import scan ===\n');

  const moveMap = new Map();
  for (const [oldRel, newRel] of Object.entries(FILE_MOVES)) {
    moveMap.set(path.join(SRC, oldRel), path.join(SRC, newRel));
  }

  const allFiles = [];
  walkDir(SRC, allFiles);
  walkDir(path.join(ROOT, 'tests'), allFiles);
  walkDir(path.join(ROOT, 'app'), allFiles);
  walkDir(path.join(ROOT, 'vitest.mocks'), allFiles);

  let totalFixed = 0;

  for (const filePath of allFiles) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;
    const fileDir = path.dirname(filePath);

    // Find all relative path strings in import-like contexts
    const importRegex = /(['"])(\.\.?\/[^'"]+)\1/g;
    const replacements = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const quote = match[1];
      const importPath = match[2];

      // Skip CSS/JSON imports
      if (/\.(css|json|svg|png|jpg)$/.test(importPath)) continue;

      // Check if it currently resolves
      const currentResolved = resolveImport(fileDir, importPath);
      if (currentResolved) continue; // Still valid

      // It's broken. Try to find where the target moved to.
      const base = path.resolve(fileDir, importPath);

      let found = false;
      for (const ext of ['', '.ts', '.tsx']) {
        const candidate = base + ext;
        if (moveMap.has(candidate)) {
          const newTarget = moveMap.get(candidate);
          const newImport = computeNewImportPath(filePath, newTarget);
          if (newImport !== importPath) {
            replacements.push({ oldImport: importPath, newImport, quote });
          }
          found = true;
          break;
        }
      }
      if (!found) {
        for (const idx of ['/index.ts', '/index.tsx']) {
          const candidate = base + idx;
          if (moveMap.has(candidate)) {
            const newTarget = moveMap.get(candidate);
            const newImport = computeNewImportPath(filePath, newTarget);
            if (newImport !== importPath) {
              replacements.push({ oldImport: importPath, newImport, quote });
            }
            break;
          }
        }
      }
    }

    // De-duplicate replacements
    const seen = new Set();
    const uniqueReplacements = replacements.filter(r => {
      const key = `${r.oldImport}→${r.newImport}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const r of uniqueReplacements) {
      const escaped = escapeRegex(r.oldImport);
      const replaceRegex = new RegExp(
        `(${escapeRegex(r.quote)})${escaped}(${escapeRegex(r.quote)})`, 'g'
      );
      const before = content;
      content = content.replace(replaceRegex, `$1${r.newImport}$2`);
      if (content !== before) {
        modified = true;
        totalFixed++;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`  Fixed: ${path.relative(ROOT, filePath)}`);
    }
  }

  console.log(`\n  Total comprehensive fixes: ${totalFixed}`);
}

// ================================================================
// MAIN
// ================================================================

fixMovedFileImports();
fixTestMockPaths();
fixAllBrokenImports();
console.log('\n=== Fix pass complete! ===');
