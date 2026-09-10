import type { AutomationEntry } from "../types/recording/automationLibrary";

const createdAt = "2026-09-10T00:00:00.000Z";
/** Original app-shipped diagnostic sequences, not inferred conversions of scripts. */
export const bundledMacroCatalog: AutomationEntry<"terminal-macro">[] = [
  {
    id: "unix-identity",
    name: "Unix identity and working directory",
    platforms: ["linux", "macos"],
    commands: ["whoami", "pwd"],
  },
  {
    id: "unix-system",
    name: "Unix system and uptime",
    platforms: ["linux", "macos"],
    commands: ["uname -a", "uptime"],
  },
  {
    id: "powershell-identity",
    name: "PowerShell identity and location",
    platforms: ["windows"],
    commands: ["whoami", "Get-Location"],
  },
  {
    id: "eos-status",
    name: "Arista EOS version and clock",
    platforms: ["arista-eos"],
    commands: ["show version", "show clock"],
  },
].map((item) => ({
  family: "terminal-macro",
  payload: {
    id: `bundled-macro:${item.id}`,
    name: item.name,
    description:
      "Diagnostic terminal sequence. Review commands and target platform before replay; output may contain identifying system information.",
    category: "Diagnostics",
    tags: ["diagnostic"],
    createdAt,
    updatedAt: createdAt,
    steps: item.commands.map((command) => ({
      command,
      delayMs: 300,
      sendNewline: true,
    })),
  },
  provenance: {
    sourceId: `bundled-macro:${item.id}`,
    publisher: "sortOfRemoteNG (app-shipped)",
    platforms: item.platforms,
    tags: ["diagnostic", "review-target"],
  },
}));
