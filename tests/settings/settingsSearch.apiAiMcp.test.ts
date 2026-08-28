import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_INDEX } from "../../src/components/SettingsDialog/settingsSearchIndex";
import {
  AI_SEARCH_ENTRIES,
  API_SEARCH_ENTRIES,
  MCP_SERVER_SEARCH_ENTRIES,
  RECOVERY_SEARCH_ENTRIES,
} from "../../src/components/SettingsDialog/settingsSearchIndex";
import type { SettingSearchEntry } from "../../src/components/SettingsDialog/settingsSearchIndex/types";
import { matchSettingsEntries } from "../../src/components/SettingsDialog/settingsSearchMatch";

/* ═══════════════════════════════════════════════════════════════
   t75-e5 — `api`, `ai`, `mcpServer`, `recovery`

   The drift guard proves the index and the rendered controls agree. It does
   NOT prove the index is *useful*: an entry can join correctly and still be
   unfindable because nobody types its key.

   These assertions are the other half — the vocabulary a sysadmin actually
   types. All four tabs had **zero** usable entries before this task
   (`.orchestration/plans/t75.md` §3.2: api/ai/recovery absent entirely,
   mcpServer 8 entries all stale), so every query below returned nothing.
   ═══════════════════════════════════════════════════════════════ */

/** Search the whole index, exactly as `useSettingsSearch` does. */
function search(query: string): SettingSearchEntry[] {
  return matchSettingsEntries(SETTINGS_SEARCH_INDEX, query);
}

const keys = (entries: SettingSearchEntry[]) => entries.map((e) => e.key);

/** The keys a query resolves to, restricted to one tab. */
function keysIn(query: string, section: string): string[] {
  return keys(search(query).filter((e) => e.section === section));
}

/** The best-ranked result overall. */
function top(query: string): SettingSearchEntry | undefined {
  return search(query)[0];
}

describe("settings search — API Server tab", () => {
  it.each([
    ["rest api", "restApi.enabled"],
    ["api server", "restApi.enabled"],
    ["bearer", "restApi.apiKey"],
    ["bearer token", "restApi.apiKey"],
    ["api key", "restApi.apiKey"],
    ["jwt", "restApi.authentication"],
    ["api port", "restApi.port"],
    ["9876", "restApi.port"],
    ["random port", "restApi.useRandomPort"],
    ["allow remote connections", "restApi.allowRemoteConnections"],
    ["https", "restApi.sslEnabled"],
    ["certificate mode", "restApi.sslMode"],
    ["certificate path", "restApi.sslCertPath"],
    ["private key path", "restApi.sslKeyPath"],
    ["worker threads", "restApi.maxThreads"],
    ["request timeout", "restApi.requestTimeout"],
    ["rate limiting", "restApi.rateLimiting"],
    ["requests per minute", "restApi.maxRequestsPerMinute"],
  ])("resolves %j to %j", (query, key) => {
    expect(keysIn(query, "api")).toContain(key);
  });

  it("finds the tab by its sidebar name — plan §3.3 listed this as 0 results", () => {
    expect(keysIn("API Server", "api").length).toBeGreaterThan(0);
  });

  it("searches the SSL mode option text, both value and label", () => {
    // The user reads "Let's Encrypt (Auto-Renew)" on screen but may type any of
    // these. `values` holds both halves of the pair; the matcher squashes
    // punctuation, so the apostrophe and the hyphens do not matter.
    for (const query of [
      "letsencrypt",
      "let's encrypt",
      "lets encrypt",
      "self-signed",
      "self signed",
      "auto-generate self-signed",
      "manual",
    ]) {
      expect(keysIn(query, "api")).toContain("restApi.sslMode");
    }
  });

  it("indexes every literal option of the SSL mode select", () => {
    const entry = API_SEARCH_ENTRIES.find((e) => e.key === "restApi.sslMode");
    expect(entry?.values).toEqual(
      expect.arrayContaining([
        "manual",
        "self-signed",
        "letsencrypt",
        "Manual (Provide Certificate)",
        "Auto-Generate Self-Signed",
        "Let's Encrypt (Auto-Renew)",
      ]),
    );
  });

  it("puts the port setting first for a bare 'port' query in this tab", () => {
    expect(keysIn("port", "api")[0]).toBe("restApi.port");
  });
});

describe("settings search — AI / LLM Router tab", () => {
  it.each([
    ["llm", "llm.provider.type"],
    ["openai", "llm.provider.type"],
    ["anthropic", "llm.provider.type"],
    ["ollama", "llm.provider.type"],
    ["bedrock", "llm.provider.type"],
    ["hugging face", "llm.provider.type"],
    ["openrouter", "llm.provider.type"],
    ["balancer strategy", "llm.router.balancerStrategy"],
    ["round robin", "llm.router.balancerStrategy"],
    ["least latency", "llm.router.balancerStrategy"],
    ["failover", "llm.router.failoverEnabled"],
    ["sticky sessions", "llm.router.stickySessions"],
    ["usage tracking", "llm.router.usageTracking"],
    ["cache ttl", "llm.cache.ttlSeconds"],
    ["cache embeddings", "llm.cache.embeddings"],
    ["max retries", "llm.provider.maxRetries"],
    ["organization id", "llm.provider.orgId"],
    ["base url", "llm.provider.baseUrl"],
    ["estimate tokens", "llm.playground.tokenText"],
    ["chat completion", "llm.playground.prompt"],
  ])("resolves %j to %j", (query, key) => {
    expect(keysIn(query, "ai")).toContain(key);
  });

  it("finds the tab by its sidebar name — plan §3.3 listed this as 0 results", () => {
    expect(keysIn("AI / LLM Router", "ai").length).toBeGreaterThan(0);
  });

  it("searches every provider vendor name the select offers", () => {
    // `PROVIDER_TYPES` is an imported constant, so the drift guard cannot read
    // it — these are the queries that keep the mirrored `values` list honest.
    for (const vendor of [
      "OpenAI",
      "Anthropic",
      "Google Gemini",
      "Ollama",
      "Azure OpenAI",
      "Groq",
      "Mistral AI",
      "Cohere",
      "DeepSeek",
      "Together AI",
      "Fireworks AI",
      "Perplexity",
      "Hugging Face",
      "AWS Bedrock",
      "OpenRouter",
      "Local (GGUF)",
    ]) {
      expect(keysIn(vendor, "ai")).toContain("llm.provider.type");
    }
  });

  it("searches every balancer strategy, snake_case value and prose label alike", () => {
    for (const strategy of [
      "priority",
      "round_robin",
      "round robin",
      "least_latency",
      "least latency",
      "least_cost",
      "least cost",
      "weighted_random",
      "weighted random",
    ]) {
      expect(keysIn(strategy, "ai")).toContain("llm.router.balancerStrategy");
    }
  });

  it("keeps the provider API key findable by vault vocabulary", () => {
    for (const query of ["api key", "secret", "credential", "vault"]) {
      expect(keysIn(query, "ai")).toContain("llm.provider.apiKey");
    }
  });
});

describe("settings search — MCP Server tab", () => {
  it.each([
    "mcp",
    "mcp server",
    "model context protocol",
    "modelcontextprotocol",
    "mcp port",
    "mcp host",
    "server sent events",
    "sse",
    "cors",
    "server instructions",
    "expose sensitive data",
    "session timeout",
    "max sessions",
    "log level",
    "rate limit mcp",
  ])("resolves %j to the MCP tab", (query) => {
    expect(keysIn(query, "mcpServer")).toEqual(["mcpServer.config"]);
  });

  it("finds the tab by its sidebar name", () => {
    expect(keysIn("MCP Server", "mcpServer")).toEqual(["mcpServer.config"]);
  });

  it("searches the log level option values", () => {
    for (const level of ["debug", "notice", "critical"]) {
      expect(keysIn(level, "mcpServer")).toEqual(["mcpServer.config"]);
    }
  });

  it("has dropped the eight stale entries that navigated nowhere", () => {
    // plan §3.1 — every mcpServer entry was an orphan before t75.
    expect(keys(MCP_SERVER_SEARCH_ENTRIES)).toEqual(["mcpServer.config"]);
    for (const stale of [
      "mcpServer.allow_remote",
      "mcpServer.auto_start",
      "mcpServer.enabled",
      "mcpServer.expose_sensitive_data",
      "mcpServer.host",
      "mcpServer.port",
      "mcpServer.require_auth",
      "mcpServer.server_instructions",
    ]) {
      expect(SETTINGS_SEARCH_INDEX.some((e) => e.key === stale)).toBe(false);
    }
  });
});

describe("settings search — Recovery tab", () => {
  it.each([
    ["reset settings", "recovery.resetSettings"],
    ["restore defaults", "recovery.resetSettings"],
    ["factory reset", "recovery.deleteAllData"],
    ["delete all data", "recovery.deleteAllData"],
    ["delete app data", "recovery.deleteAppData"],
    ["clear cache", "recovery.deleteAppData"],
    ["soft restart", "recovery.softRestart"],
    ["reload frontend", "recovery.softRestart"],
    ["hard restart", "recovery.hardRestart"],
    ["reboot", "recovery.hardRestart"],
  ])("resolves %j to %j", (query, key) => {
    expect(keysIn(query, "recovery")).toContain(key);
  });

  it("finds the tab by its sidebar name — the tab was absent from the index", () => {
    expect(keysIn("Recovery", "recovery").length).toBeGreaterThan(0);
  });

  it("anchors every action row it advertises", () => {
    expect(keys(RECOVERY_SEARCH_ENTRIES).sort()).toEqual([
      "recovery.deleteAllData",
      "recovery.deleteAppData",
      "recovery.hardRestart",
      "recovery.resetSettings",
      "recovery.softRestart",
    ]);
  });
});

describe("cross-tab behaviour for these four tabs", () => {
  it("ranks the API tab's own port setting above other tabs for 'api port'", () => {
    expect(top("api port")?.section).toBe("api");
  });

  it("returns nothing for a query that matches none of them", () => {
    expect(
      search("zzzzz-not-a-setting").filter((e) =>
        ["api", "ai", "mcpServer", "recovery"].includes(e.section),
      ),
    ).toEqual([]);
  });

  it("gives every entry in these tabs a description and at least one tag", () => {
    const thin = [
      ...API_SEARCH_ENTRIES,
      ...AI_SEARCH_ENTRIES,
      ...MCP_SERVER_SEARCH_ENTRIES,
      ...RECOVERY_SEARCH_ENTRIES,
    ]
      .filter((e) => e.description.length < 20 || e.tags.length === 0)
      .map((e) => e.key);
    expect(thin).toEqual([]);
  });

  it("files every entry under its own tab", () => {
    expect([...new Set(API_SEARCH_ENTRIES.map((e) => e.section))]).toEqual([
      "api",
    ]);
    expect([...new Set(AI_SEARCH_ENTRIES.map((e) => e.section))]).toEqual([
      "ai",
    ]);
    expect([
      ...new Set(MCP_SERVER_SEARCH_ENTRIES.map((e) => e.section)),
    ]).toEqual(["mcpServer"]);
    expect([...new Set(RECOVERY_SEARCH_ENTRIES.map((e) => e.section))]).toEqual(
      ["recovery"],
    );
  });

  it("resolves a translated label through `t` as well as the English one", () => {
    // §4.3 — non-English search comes from `labelKey`, with no locale changes.
    const t = (key: string) =>
      key === "integrations.llm.balancerStrategy"
        ? "Balancer-Strategie"
        : key === "settings.api.port"
          ? "Anschluss"
          : key;
    const german = matchSettingsEntries(
      SETTINGS_SEARCH_INDEX,
      "Balancer-Strategie",
      { t },
    );
    expect(keys(german)).toContain("llm.router.balancerStrategy");

    const port = matchSettingsEntries(SETTINGS_SEARCH_INDEX, "Anschluss", {
      t,
    });
    expect(keys(port)).toContain("restApi.port");
  });
});
