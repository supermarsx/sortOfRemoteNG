import {
  createLucideIcon,
  FileCheck2,
  ListChecks,
  Search,
  SlidersHorizontal,
  SquareMousePointer,
} from "lucide-react";
import { modelcontextprotocol, vscode } from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

/** Two distinct issue glyphs collected in a tray, not a second single-bug alias. */
const BugCollectionIcon = createLucideIcon("BugCollection", [
  [
    "path",
    {
      d: "M2 17h20v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3M9 17v2h6v-2",
      key: "collection-tray",
    },
  ],
  [
    "rect",
    { x: "5", y: "6", width: "4", height: "7", rx: "2", key: "left-body" },
  ],
  [
    "path",
    {
      d: "M5 7 3 5m6 2 2-2M5 10H2m7 0h3M5 12l-2 2m6-2 2 2M6 6V4m2 2V4",
      key: "left-legs",
    },
  ],
  [
    "rect",
    { x: "16", y: "4", width: "4", height: "7", rx: "2", key: "right-body" },
  ],
  [
    "path",
    {
      d: "m16 5-2-2m6 2 2-2M16 8h-3m7 0h3m-7 2-2 2m6-2 2 2M17 4V2m2 2V2",
      key: "right-legs",
    },
  ],
]);

export const DEVELOPER_TOOL_ICONS = [
  defineIcon(
    "mcp",
    "Model Context Protocol",
    "devops-monitoring",
    modelcontextprotocol,
    [
      "mcp",
      "model context protocol",
      "ai integration",
      "tool protocol",
      "plain",
    ],
    "Model Context Protocol's published mark, vendored through the pinned Simple Icons collection.",
  ),
  defineIcon(
    "mcp-server",
    "MCP server",
    "devops-monitoring",
    createRoleIcon("MCPServer", "server", modelcontextprotocol),
    [
      "mcp server",
      "model context protocol server",
      "ai tools",
      "context server",
      "mcp host",
    ],
    "Server silhouette with the Model Context Protocol mark in the bottom-right corner.",
  ),
  defineIcon(
    "vscode",
    "Visual Studio Code",
    "devops-monitoring",
    vscode,
    [
      "vscode",
      "vs code",
      "visual studio code",
      "microsoft editor",
      "ide",
      "code editor",
    ],
    "Microsoft Visual Studio Code publisher silhouette in the selected icon color; not Coder code-server branding.",
  ),
  defineIcon(
    "inspector",
    "Inspector tool",
    "devops-monitoring",
    SquareMousePointer,
    [
      "inspector",
      "inspector tool",
      "inspect element",
      "devtools",
      "developer tools",
      "debug inspector",
      "element selector",
    ],
  ),
  defineIcon("magnifier", "Magnifying glass", "devops-monitoring", Search, [
    "magnifier",
    "magnifier glass",
    "magnifying glass",
    "search",
    "find",
    "inspect",
    "zoom",
  ]),
  defineIcon("linter", "Linter", "devops-monitoring", FileCheck2, [
    "linter",
    "lint",
    "linting",
    "static analysis",
    "code quality",
    "eslint",
    "clippy",
    "validation",
  ]),
  defineIcon(
    "bug-collection",
    "Bug collection",
    "devops-monitoring",
    BugCollectionIcon,
    [
      "bug collection",
      "bugs",
      "bug tracker",
      "issue collection",
      "defects",
      "triage",
      "issue backlog",
    ],
  ),
  defineIcon(
    "test-checklist",
    "Test checklist",
    "devops-monitoring",
    ListChecks,
    [
      "test",
      "testing",
      "test icon",
      "test checklist",
      "test cases",
      "unit tests",
      "qa",
      "validation",
      "checks",
    ],
  ),
  defineIcon(
    "control-panel-sliders",
    "Control panel sliders",
    "devops-monitoring",
    SlidersHorizontal,
    [
      "control panel",
      "control panel sliders",
      "sliders",
      "settings",
      "configuration",
      "adjustments",
      "tuning",
    ],
  ),
] as const;
