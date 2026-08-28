import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `mcpServer` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const MCP_SERVER_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── MCP Server ─────────────────────────────────────────────────
  {
    key: "mcpServer.enabled",
    label: "Enable MCP Server",
    description:
      "Allow AI assistants to connect through Model Context Protocol",
    tags: [
      "mcp",
      "model context protocol",
      "ai",
      "assistant",
      "server",
      "automation",
    ],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
  {
    key: "mcpServer.auto_start",
    label: "MCP Auto-start",
    description: "Start the MCP server automatically when the app launches",
    tags: ["mcp", "startup", "auto start", "launch"],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
  {
    key: "mcpServer.host",
    label: "MCP Host",
    description: "Host address the MCP server binds to",
    tags: ["mcp", "host", "bind", "localhost", "network"],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
  {
    key: "mcpServer.port",
    label: "MCP Port",
    description: "TCP port used by the MCP server",
    tags: ["mcp", "port", "network", "http"],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
  {
    key: "mcpServer.require_auth",
    label: "MCP Authentication",
    description: "Require API key authentication for MCP requests",
    tags: ["mcp", "auth", "api key", "security", "bearer"],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
  {
    key: "mcpServer.allow_remote",
    label: "MCP Remote Access",
    description: "Allow non-localhost clients to connect to the MCP server",
    tags: ["mcp", "remote", "network", "security"],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
  {
    key: "mcpServer.expose_sensitive_data",
    label: "MCP Sensitive Data",
    description:
      "Control whether MCP resources can include passwords and secrets",
    tags: ["mcp", "secrets", "passwords", "privacy", "security"],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
  {
    key: "mcpServer.server_instructions",
    label: "MCP Server Instructions",
    description: "Instructions sent to MCP clients during initialization",
    tags: ["mcp", "instructions", "prompt", "client"],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
];
