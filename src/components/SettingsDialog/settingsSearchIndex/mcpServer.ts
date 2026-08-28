import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `mcpServer` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * ── Why this tab has one entry and not eighteen ──────────────────
 *
 * The MCP settings form is `src/components/ssh/mcpServer/ConfigTab.tsx`, shared
 * with `McpServerPanel` outside the Settings dialog. `sections/McpSettings.tsx`
 * only wraps it. That directory sits outside the drift guard's scan root, so a
 * per-field `settingKey` added there would be invisible to the guard and every
 * entry pointing at one would be flagged as an orphan — a dead search result by
 * the guard's definition.
 *
 * So the tab is anchored once, on the wrapper in `sections/McpSettings.tsx`, and
 * this single entry carries the vocabulary of all eighteen MCP settings. Every
 * MCP term the user might type resolves, and the result navigates to the MCP
 * configuration rather than nowhere. Splitting it into per-field entries needs
 * the shared form to move under `sections/` (or the guard to learn about
 * `src/components/ssh/mcpServer/`) — recorded as a follow-up in
 * `.orchestration/logs/t75-e5.md`.
 */
export const MCP_SERVER_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "mcpServer.config",
    label: "MCP server configuration",
    labelKey: "mcpServer.title",
    description:
      "Model Context Protocol server that lets AI assistants connect to this application: enable and auto-start it, set the host, port and API key, require authentication, allow remote connections, expose or withhold sensitive data, cap concurrent sessions, session timeout and rate limit, pick a log level, turn CORS and SSE on or off, write the instructions sent to clients, and choose which tools, resources and prompts are exposed.",
    descriptionKey: "settings.mcpServer.description",
    tags: [
      "mcp",
      "model context protocol",
      "ai",
      "assistant",
      "server",
      "automation",
      "integration",
      "enable",
      "auto start",
      "start on launch",
      "host",
      "bind",
      "localhost",
      "port",
      "network",
      "api key",
      "bearer",
      "token",
      "authentication",
      "auth",
      "require auth",
      "security",
      "remote",
      "allow remote",
      "expose sensitive data",
      "secrets",
      "passwords",
      "sessions",
      "max sessions",
      "concurrent",
      "session timeout",
      "rate limit",
      "throttle",
      "log level",
      "logging",
      "cors",
      "cross origin",
      "sse",
      "server sent events",
      "streaming",
      "notifications",
      "instructions",
      "server instructions",
      "prompt",
      "tools",
      "toolset",
      "resources",
      "prompts",
      "capabilities",
      "client",
    ],
    synonyms: [
      "mcp server",
      "modelcontextprotocol",
      "context protocol",
      "ai assistant server",
      "claude integration",
      "bearer token",
      "cross-origin resource sharing",
      "server-sent events",
      "requests per minute",
    ],
    values: [
      "debug",
      "info",
      "notice",
      "warning",
      "error",
      "critical",
      "127.0.0.1",
      "0.0.0.0",
    ],
    section: "mcpServer",
    sectionLabel: "MCP Server",
  },
];
