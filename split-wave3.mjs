/**
 * Wave 3 component splitting — extract inline sub-components from large files.
 *
 * Strategy per file:
 * 1. Read the file
 * 2. For each sub-component block (identified by line ranges):
 *    a. Extract the block
 *    b. Collect its import needs from the parent
 *    c. Write it to a sub-file with proper imports
 * 3. Rewrite the parent as an orchestrator that imports sub-components
 */
import fs from "fs";
import path from "path";

// ══════════════════════════════════════════════════════════════════════
//  Configuration: each target file and its sub-component line ranges
// ══════════════════════════════════════════════════════════════════════
const TARGETS = [
  {
    file: "src/components/protocol/WhatsAppPanel.tsx",
    dir: "src/components/protocol/whatsApp",
    // Shared preamble lines (types + constants) that go into a shared file
    sharedRange: [51, 73],
    sharedFile: "types.ts",
    subs: [
      { name: "StatusBadge", range: [75, 88] },
      { name: "ErrorMsg", range: [90, 96] },
      { name: "LoadingSpinner", range: [98, 101] },
      { name: "SettingsTab", range: [104, 244] },
      { name: "ComposeTab", range: [246, 519] },
      { name: "ChatTab", range: [522, 642] },
      { name: "TemplatesTab", range: [646, 727] },
      { name: "MediaTab", range: [731, 834] },
      { name: "ContactsTab", range: [838, 942] },
      { name: "PairingTab", range: [946, 1086] },
    ],
    mainRange: [1096, 1174],
    mainName: "WhatsAppPanel",
  },
  {
    file: "src/components/connectionEditor/HTTPOptions.tsx",
    dir: "src/components/connectionEditor/httpOptions",
    sharedRange: [29, 37],
    sharedFile: "types.ts",
    subs: [
      { name: "AuthTypeSection", range: [40, 48] },
      { name: "BasicAuthFields", range: [49, 107] },
      { name: "TlsVerifySection", range: [109, 144] },
      { name: "TrustPolicySection", range: [146, 246] },
      { name: "CustomHeadersSection", range: [248, 296] },
      { name: "BookmarksSection", range: [299, 422] },
      { name: "BookmarkModal", range: [425, 505] },
      { name: "HeaderModal", range: [507, 580] },
      { name: "NicknameEditButton", range: [610, 678] },
    ],
    mainRange: [587, 609],
    mainName: "HTTPOptions",
  },
  {
    file: "src/components/ssh/BulkSSHCommander.tsx",
    dir: "src/components/ssh/bulkCommander",
    sharedRange: [122, 125],
    sharedFile: "types.ts",
    subs: [
      { name: "SecondaryToolbar", range: [127, 192] },
      { name: "ScriptLibraryPanel", range: [194, 329] },
      { name: "SessionPanel", range: [331, 412] },
      { name: "CommandInput", range: [414, 467] },
      { name: "OutputArea", range: [469, 479] },
      { name: "TabOutputView", range: [481, 526] },
      { name: "MosaicOutputView", range: [528, 628] },
    ],
    mainRange: [29, 120],
    mainName: "BulkSSHCommander",
  },
  {
    file: "src/components/ssh/WebTerminal.tsx",
    dir: "src/components/ssh/webTerminal",
    sharedRange: [55, 58],
    sharedFile: "types.ts",
    subs: [
      { name: "RecordingButton", range: [60, 87] },
      { name: "MacroRecordButton", range: [89, 116] },
      { name: "MacroReplayPopover", range: [118, 170] },
      { name: "HostKeyPopover", range: [172, 203] },
      { name: "TotpPopover", range: [205, 236] },
      { name: "TerminalToolbar", range: [238, 317] },
      { name: "TerminalStatusBar", range: [319, 357] },
      { name: "HostKeyTrustBadges", range: [359, 418] },
      { name: "ScriptSelectorModal", range: [420, 549] },
      { name: "SshTrustDialog", range: [551, 579] },
    ],
    mainRange: [581, 626],
    mainName: "WebTerminal",
  },
  {
    file: "src/components/connection/ConnectionTree.tsx",
    dir: "src/components/connection/connectionTree",
    sharedRange: [42, 106],
    sharedFile: "helpers.ts",
    subs: [
      { name: "ConnectionTreeItem", range: [107, 272] },
      { name: "TreeItemMenu", range: [276, 380] },
      { name: "RenameModal", range: [384, 421] },
      { name: "ConnectOptionsModal", range: [423, 513] },
      { name: "PanelContextMenu", range: [515, 548] },
    ],
    mainRange: [549, 619],
    mainName: "ConnectionTree",
  },
  {
    file: "src/components/rdp/RDPClientHeader.tsx",
    dir: "src/components/rdp/rdpClientHeader",
    sharedRange: [38, 106],
    sharedFile: "helpers.ts",
    subs: [
      { name: "NameDisplay", range: [108, 139] },
      { name: "ConnectionControls", range: [141, 179] },
      { name: "ClipboardButtons", range: [181, 204] },
      { name: "SendKeysPopover", range: [206, 244] },
      { name: "HostInfoPopover", range: [246, 350] },
      { name: "TotpButton", range: [352, 387] },
      { name: "ToolbarButtons", range: [388, 428] },
      { name: "RecordingControls", range: [430, 484] },
    ],
    mainRange: [487, 572],
    mainName: "RDPClientHeader",
  },
  {
    file: "src/components/monitoring/PerformanceMonitor.tsx",
    dir: "src/components/monitoring/performanceMonitor",
    sharedRange: [20, 24],
    sharedFile: "types.ts",
    subs: [
      { name: "MonitorHeader", range: [27, 44] },
      { name: "SecondaryBar", range: [45, 93] },
      { name: "CurrentMetricsGrid", range: [94, 278] },
      { name: "SummaryStats", range: [280, 343] },
      { name: "RecentMetricsTable", range: [345, 469] },
    ],
    mainRange: [480, 525],
    mainName: "PerformanceMonitor",
  },
  {
    file: "src/components/recording/ScriptManager.tsx",
    dir: "src/components/recording/scriptManager",
    sharedRange: [25, 79],
    sharedFile: "shared.ts",
    subs: [
      { name: "ScriptManagerHeader", range: [81, 94] },
      { name: "FilterToolbar", range: [96, 140] },
      { name: "ScriptListItem", range: [142, 194] },
      { name: "ScriptList", range: [196, 217] },
      { name: "ScriptEditForm", range: [219, 342] },
      { name: "ScriptDetailView", range: [344, 436] },
      { name: "SelectScriptPlaceholder", range: [438, 457] },
      { name: "EditFooter", range: [459, 479] },
      { name: "DetailPane", range: [481, 496] },
    ],
    mainRange: [498, 530],
    mainName: "ScriptManager",
  },
  {
    file: "src/components/network/ProxyChainMenu.tsx",
    dir: "src/components/network/proxyChainMenu",
    sharedRange: [28, 31],
    sharedFile: "types.ts",
    subs: [
      { name: "ProfilesTab", range: [164, 295] },
      { name: "ChainsTab", range: [297, 525] },
      { name: "TunnelsTab", range: [527, 668] },
      { name: "AssociationsTab", range: [670, 713] },
    ],
    mainRange: [31, 157],
    mainName: "ProxyChainMenu",
  },
];

// ══════════════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════════════

function getLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split("\n");
}

/** Compute relative depth difference between original file and sub-dir */
function relativePrefix(originalDir, subDir) {
  return path.relative(subDir, originalDir).replace(/\\/g, "/");
}

/** Extract import lines from a block that reference external modules */
function findImportsNeeded(blockLines, allImportLines) {
  const blockText = blockLines.join("\n");
  const needed = [];
  for (const imp of allImportLines) {
    // Extract identifiers from the import line
    const match = imp.match(/import\s+(?:(?:type\s+)?{([^}]+)}|(\w+))\s+from/);
    if (!match) continue;
    const ids = match[1]
      ? match[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop().trim())
      : [match[2]];
    // Check if any of those identifiers appear in the block
    for (const id of ids) {
      if (id && blockText.includes(id)) {
        needed.push(imp);
        break;
      }
    }
  }
  return needed;
}

/** Adjust relative imports to account for deeper sub-directory */
function adjustImport(line, depthPrefix) {
  // Replace relative paths: '../' or './' with adjusted depth
  return line.replace(/(from\s+['"])(\.\.\/)/, (_, pre, rel) => {
    return `${pre}${depthPrefix}/`;
  }).replace(/(from\s+['"])(\.\/)/, (_, pre) => {
    return `${pre}${depthPrefix.replace(/\/[^/]+$/, "")}/`;
  });
}

// ══════════════════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════════════════

let totalFiles = 0;
let totalTargets = 0;

for (const target of TARGETS) {
  const filePath = target.file;
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP ${filePath} — not found`);
    continue;
  }

  const lines = getLines(filePath);
  const originalDir = path.dirname(filePath);

  // Create sub-directory
  fs.mkdirSync(target.dir, { recursive: true });

  const depthPrefix = relativePrefix(originalDir, target.dir);

  // Extract all import lines from the original file (top of file)
  const importLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.startsWith("import ") ||
      line.startsWith("import{") ||
      (line.startsWith("  ") && importLines.length > 0 && !lines[i - 1].includes(" from ") && !lines[i - 1].endsWith(";"))
    ) {
      importLines.push(line);
    } else if (importLines.length > 0 && line.trim() === "") {
      continue; // skip blank lines in import block
    } else if (importLines.length > 0) {
      break;
    }
  }

  // Merge multi-line imports
  const mergedImports = [];
  let current = "";
  for (const line of importLines) {
    current += (current ? "\n" : "") + line;
    if (current.includes(" from ") || current.endsWith(";")) {
      mergedImports.push(current);
      current = "";
    }
  }
  if (current) mergedImports.push(current);

  // Adjust import paths for deeper directory
  const adjustedImports = mergedImports.map((imp) => {
    // Multi-pass: keep adjusting '../' prefixes for depth
    let result = imp;
    // Count how many directory levels deeper the sub-dir is
    const levels = target.dir.split("/").length - originalDir.split("/").length;
    for (let i = 0; i < levels; i++) {
      result = result.replace(/(from\s+['"])(\.\.\/)/g, (_, pre, rel) => `${pre}../../`);
      result = result.replace(/(from\s+['"])(\.\/)/g, (_, pre) => `${pre}../`);
    }
    return result;
  });

  // Write shared types/helpers file
  if (target.sharedRange) {
    const [start, end] = target.sharedRange;
    const sharedLines = lines.slice(start - 1, end);
    const sharedPath = path.join(target.dir, target.sharedFile);
    const sharedImports = findImportsNeeded(sharedLines, adjustedImports);
    const content = [...sharedImports, "", ...sharedLines, ""].join("\n");
    fs.writeFileSync(sharedPath, content);
    totalFiles++;
    console.log(`  ${target.sharedFile}`);
  }

  // Write sub-component files
  const subNames = [];
  for (const sub of target.subs) {
    const [start, end] = sub.range;
    const blockLines = lines.slice(start - 1, end);

    // Find imports needed by this block
    const needed = findImportsNeeded(blockLines, adjustedImports);

    // Check if block references shared types
    const sharedRef =
      target.sharedFile &&
      blockLines.join("\n").match(/\b(Mgr|TFunc|TabId|MsgType|TABS|OSTag|ManagedScript|ScriptLanguage|OS_TAG_LABELS|OS_TAG_ICONS|languageLabels|languageIcons|SCRIPTS_STORAGE_KEY|getDefaultScripts|getProtocolIcon|iconRegistry|getConnectionIcon|getStatusColor|formatDuration|btnBase|btnDefault|btnActive|btnDisabled|SEND_KEY_OPTIONS|RDPClientHeaderProps|ConnectionTreeItemProps)\b/);

    // Check if block references sibling sub-components
    const siblingRefs = target.subs
      .filter((s) => s.name !== sub.name)
      .filter((s) => blockLines.join("\n").includes(s.name));

    // Build file content
    const parts = [];
    parts.push(...needed);

    if (sharedRef) {
      const ext = target.sharedFile.replace(/\.tsx?$/, "");
      parts.push(
        `import { ${[...new Set(blockLines.join("\n").match(/\b(Mgr|TFunc|TabId|MsgType|TABS|OSTag|ManagedScript|ScriptLanguage|OS_TAG_LABELS|OS_TAG_ICONS|languageLabels|languageIcons|SCRIPTS_STORAGE_KEY|getDefaultScripts|getProtocolIcon|iconRegistry|getConnectionIcon|getStatusColor|formatDuration|btnBase|btnDefault|btnActive|btnDisabled|SEND_KEY_OPTIONS|RDPClientHeaderProps|ConnectionTreeItemProps)\b/g) || [])].join(", ")} } from "./${ext}";`
      );
    }

    for (const sib of siblingRefs) {
      parts.push(`import ${sib.name} from "./${sib.name}";`);
    }

    parts.push("");

    // Ensure export default
    const blockText = blockLines.join("\n");
    const hasExportDefault =
      blockText.includes("export default ") ||
      blockText.includes("export default\n");

    if (!hasExportDefault) {
      // Add export to the component definition
      const firstLine = blockLines[0];
      if (firstLine.startsWith("const ") || firstLine.startsWith("function ")) {
        blockLines.push("", `export default ${sub.name};`);
      } else if (firstLine.startsWith("export const ") || firstLine.startsWith("export function ")) {
        blockLines.push("", `export default ${sub.name};`);
      }
    }

    parts.push(...blockLines);
    parts.push("");

    const subPath = path.join(target.dir, `${sub.name}.tsx`);
    fs.writeFileSync(subPath, parts.join("\n"));
    subNames.push(sub.name);
    totalFiles++;
    console.log(`  ${sub.name}.tsx`);
  }

  // Rewrite the orchestrator file
  const mainLines = lines.slice(target.mainRange[0] - 1, target.mainRange[1]);
  const mainImports = findImportsNeeded(mainLines, mergedImports);

  // Build sub-imports
  const subDir = path.basename(target.dir);
  const subImports = subNames.map(
    (n) => `import ${n} from "./${subDir}/${n}";`
  );

  // Shared type import for main
  const mainText = mainLines.join("\n");
  const mainSharedMatch = mainText.match(
    /\b(Mgr|TFunc|TabId|MsgType|TABS|OSTag|ManagedScript|RDPClientHeaderProps|ConnectionTreeItemProps|ProxyChainMenuProps|HTTPOptionsProps|WebTerminalProps|BulkSSHCommanderProps|PerformanceMonitorProps)\b/g
  );
  const sharedMainImport =
    target.sharedFile && mainSharedMatch
      ? `import { ${[...new Set(mainSharedMatch)].join(", ")} } from "./${subDir}/${target.sharedFile.replace(/\.tsx?$/, "")}";`
      : null;

  // Build orchestrator
  const orchestratorParts = [];
  orchestratorParts.push(...mainImports);
  if (sharedMainImport) orchestratorParts.push(sharedMainImport);
  orchestratorParts.push(...subImports);
  orchestratorParts.push("");
  orchestratorParts.push(...mainLines);
  orchestratorParts.push("");

  fs.writeFileSync(filePath, orchestratorParts.join("\n"));
  totalTargets++;

  console.log(
    `✓ ${target.mainName}: ${subNames.length} sub-files → ${target.dir}/`
  );
}

console.log(
  `\nDone: ${totalFiles} sub-files created across ${totalTargets} targets.`
);
