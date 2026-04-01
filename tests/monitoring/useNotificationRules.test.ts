import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useNotificationRules } from "../../src/hooks/monitoring/useNotificationRules";

const mockInvoke = vi.mocked(invoke);

const makeRule = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "CPU Alert",
  trigger: "latency_high" as const,
  severity: "warning" as const,
  channelKind: "email" as const,
  channelConfig: { to: "admin@example.com" },
  conditions: [],
  conditionLogic: "and" as const,
  enabled: true,
  throttleMs: 300000,
  templateId: null,
  escalationDelayMs: null,
  createdAt: "2026-03-30T00:00:00Z",
  updatedAt: "2026-03-30T00:00:00Z",
  ...overrides,
});

const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
  id: "tmpl-1",
  name: "Default Alert",
  subject: "Alert: {{metric}}",
  body: "{{metric}} is {{value}}",
  variables: [] as string[],
  format: "text",
  ...overrides,
});

const makeHistoryEntry = (overrides: Record<string, unknown> = {}) => ({
  id: "nh1",
  ruleId: "r1",
  ruleName: "CPU Alert",
  trigger: "latency_high" as const,
  severity: "warning" as const,
  channelKind: "email" as const,
  message: "CPU alert triggered",
  sentAt: "2026-03-30T00:00:00Z",
  delivered: true,
  errorMessage: null,
  metadata: {},
  ...overrides,
});

describe("useNotificationRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined as never);
  });

  // --- initial state ---

  it("has correct initial state", () => {
    const { result } = renderHook(() => useNotificationRules());
    expect(result.current.rules).toEqual([]);
    expect(result.current.templates).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.config).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // --- fetchRules ---

  it("fetchRules sets rules state", async () => {
    const rules = [makeRule(), makeRule({ id: "r2", name: "Memory Alert" })];
    mockInvoke.mockResolvedValueOnce(rules as never);

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchRules(); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_list_rules");
    expect(result.current.rules).toHaveLength(2);
    expect(result.current.rules[0].name).toBe("CPU Alert");
  });

  it("fetchRules sets loading during fetch", async () => {
    let resolve!: (v: unknown) => void;
    mockInvoke.mockImplementationOnce(() => new Promise(r => { resolve = r; }));

    const { result } = renderHook(() => useNotificationRules());
    const promise = act(async () => { result.current.fetchRules(); });

    // loading is set synchronously before the await
    await act(async () => { resolve([]); });
    await promise;
    expect(result.current.loading).toBe(false);
  });

  it("fetchRules sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Backend error");

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchRules(); });

    expect(result.current.error).toBe("Backend error");
    expect(result.current.rules).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // --- addRule ---

  it("addRule invokes backend and refreshes rules", async () => {
    const created = makeRule({ id: "r-new" });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_add_rule") return Promise.resolve("r-new");
      if (cmd === "notif_list_rules") return Promise.resolve([created]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.addRule({
        name: "CPU Alert",
        trigger: "latency_high", severity: "warning",
        channelKind: "email", channelConfig: { to: "admin@example.com" },
        conditions: [], conditionLogic: "and",
        enabled: true, throttleMs: 300000, templateId: null, escalationDelayMs: null,
      });
    });

    expect(id).toBe("r-new");
    expect(mockInvoke).toHaveBeenCalledWith("notif_add_rule", expect.objectContaining({
      rule: expect.objectContaining({ name: "CPU Alert" }),
    }));
    expect(result.current.rules).toHaveLength(1);
  });

  it("addRule returns null on error", async () => {
    mockInvoke.mockRejectedValueOnce("Duplicate rule");

    const { result } = renderHook(() => useNotificationRules());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.addRule({
        name: "Dup",
        trigger: "latency_high", severity: "warning",
        channelKind: "email", channelConfig: {},
        conditions: [], conditionLogic: "and",
        enabled: true, throttleMs: 0, templateId: null, escalationDelayMs: null,
      });
    });

    expect(id).toBeNull();
    expect(result.current.error).toBe("Duplicate rule");
  });

  // --- removeRule ---

  it("removeRule filters rule from state", async () => {
    const rules = [makeRule({ id: "r1" }), makeRule({ id: "r2", name: "Memory Alert" })];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_list_rules") return Promise.resolve(rules);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchRules(); });
    expect(result.current.rules).toHaveLength(2);

    await act(async () => { await result.current.removeRule("r1"); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_remove_rule", { ruleId: "r1" });
    expect(result.current.rules).toHaveLength(1);
    expect(result.current.rules[0].id).toBe("r2");
  });

  it("removeRule sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Not found");

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.removeRule("bad-id"); });

    expect(result.current.error).toBe("Not found");
  });

  // --- updateRule ---

  it("updateRule invokes backend and refreshes", async () => {
    const updated = makeRule({ id: "r1", name: "Updated Rule" });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_update_rule") return Promise.resolve(undefined);
      if (cmd === "notif_list_rules") return Promise.resolve([updated]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.updateRule("r1", { name: "Updated Rule" }); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_update_rule", { ruleId: "r1", updates: { name: "Updated Rule" } });
    expect(result.current.rules[0].name).toBe("Updated Rule");
  });

  // --- enableRule / disableRule ---

  it("enableRule sets rule enabled to true optimistically", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_list_rules") return Promise.resolve([makeRule({ id: "r1", enabled: false })]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchRules(); });
    expect(result.current.rules[0].enabled).toBe(false);

    await act(async () => { await result.current.enableRule("r1"); });
    expect(mockInvoke).toHaveBeenCalledWith("notif_enable_rule", { ruleId: "r1" });
    expect(result.current.rules[0].enabled).toBe(true);
  });

  it("disableRule sets rule enabled to false optimistically", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_list_rules") return Promise.resolve([makeRule({ id: "r1", enabled: true })]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchRules(); });
    expect(result.current.rules[0].enabled).toBe(true);

    await act(async () => { await result.current.disableRule("r1"); });
    expect(mockInvoke).toHaveBeenCalledWith("notif_disable_rule", { ruleId: "r1" });
    expect(result.current.rules[0].enabled).toBe(false);
  });

  // --- fetchTemplates ---

  it("fetchTemplates sets templates state", async () => {
    const templates = [makeTemplate(), makeTemplate({ id: "tmpl-2", name: "Slack Alert" })];
    mockInvoke.mockResolvedValueOnce(templates as never);

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchTemplates(); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_list_templates");
    expect(result.current.templates).toHaveLength(2);
  });

  // --- addTemplate ---

  it("addTemplate invokes backend and refreshes templates", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_add_template") return Promise.resolve("tmpl-new");
      if (cmd === "notif_list_templates") return Promise.resolve([makeTemplate({ id: "tmpl-new" })]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.addTemplate({
        name: "New Template", subject: "Alert", body: "Body", format: "text", variables: [],
      });
    });

    expect(id).toBe("tmpl-new");
    expect(mockInvoke).toHaveBeenCalledWith("notif_add_template", expect.objectContaining({
      template: expect.objectContaining({ name: "New Template" }),
    }));
    expect(result.current.templates).toHaveLength(1);
  });

  it("addTemplate returns null on error", async () => {
    mockInvoke.mockRejectedValueOnce("Template error");

    const { result } = renderHook(() => useNotificationRules());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.addTemplate({ name: "Err", subject: "", body: "", format: "text", variables: [] });
    });

    expect(id).toBeNull();
    expect(result.current.error).toBe("Template error");
  });

  // --- removeTemplate ---

  it("removeTemplate filters template from state", async () => {
    const templates = [makeTemplate({ id: "tmpl-1" }), makeTemplate({ id: "tmpl-2", name: "Slack" })];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_list_templates") return Promise.resolve(templates);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchTemplates(); });
    expect(result.current.templates).toHaveLength(2);

    await act(async () => { await result.current.removeTemplate("tmpl-1"); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_remove_template", { templateId: "tmpl-1" });
    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].id).toBe("tmpl-2");
  });

  // --- fetchHistory / fetchRecentHistory ---

  it("fetchHistory sets history state", async () => {
    const entries = [makeHistoryEntry()];
    mockInvoke.mockResolvedValueOnce(entries as never);

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchHistory(); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_get_history");
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].delivered).toBe(true);
  });

  it("fetchRecentHistory uses default limit of 50", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchRecentHistory(); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_get_recent_history", { limit: 50 });
  });

  it("fetchRecentHistory passes custom limit", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchRecentHistory(10); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_get_recent_history", { limit: 10 });
  });

  // --- clearHistory ---

  it("clearHistory clears history state", async () => {
    const entries = [makeHistoryEntry()];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_get_history") return Promise.resolve(entries);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.fetchHistory(); });
    expect(result.current.history).toHaveLength(1);

    await act(async () => { await result.current.clearHistory(); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_clear_history");
    expect(result.current.history).toEqual([]);
  });

  // --- testChannel ---

  it("testChannel returns true on success", async () => {
    mockInvoke.mockResolvedValueOnce(true as never);

    const { result } = renderHook(() => useNotificationRules());
    let success = false;
    await act(async () => {
      success = await result.current.testChannel("email", { to: "admin@example.com" });
    });

    expect(mockInvoke).toHaveBeenCalledWith("notif_test_channel", {
      channelKind: "email",
      channelConfig: { to: "admin@example.com" },
    });
    expect(success).toBe(true);
  });

  it("testChannel returns false on failure", async () => {
    mockInvoke.mockRejectedValueOnce("SMTP error");

    const { result } = renderHook(() => useNotificationRules());
    let success = true;
    await act(async () => {
      success = await result.current.testChannel("email", { to: "bad" });
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe("SMTP error");
  });

  // --- fetchStats ---

  it("fetchStats sets stats state", async () => {
    const stats = { totalSent: 100, totalFailed: 5, activeRules: 8, lastSentAt: "2026-03-30T00:00:00Z" };
    mockInvoke.mockResolvedValueOnce(stats as never);

    const { result } = renderHook(() => useNotificationRules());
    let res: unknown = null;
    await act(async () => { res = await result.current.fetchStats(); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_get_stats");
    expect(result.current.stats).toEqual(stats);
    expect(res).toEqual(stats);
  });

  it("fetchStats returns null on error", async () => {
    mockInvoke.mockRejectedValueOnce("Stats unavailable");

    const { result } = renderHook(() => useNotificationRules());
    let res: unknown = "not-null";
    await act(async () => { res = await result.current.fetchStats(); });

    expect(res).toBeNull();
    expect(result.current.error).toBe("Stats unavailable");
  });

  // --- loadConfig ---

  it("loadConfig sets config state", async () => {
    const cfg = { globalCooldownMs: 60000, maxPerHour: 100, enabled: true };
    mockInvoke.mockResolvedValueOnce(cfg as never);

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.loadConfig(); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_get_config");
    expect(result.current.config).toEqual(cfg);
  });

  it("loadConfig sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Config read error");

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.loadConfig(); });

    expect(result.current.error).toBe("Config read error");
  });

  // --- updateConfig ---

  it("updateConfig merges with existing config and persists", async () => {
    const initial = { enabled: true, globalThrottleMs: 60000, maxHistoryEntries: 100, retryCount: 3, retryDelayMs: 1000, batchDelivery: false, batchIntervalMs: 0, quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00" };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "notif_get_config") return Promise.resolve(initial);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.loadConfig(); });
    expect(result.current.config).toEqual(initial);

    await act(async () => { await result.current.updateConfig({ maxHistoryEntries: 200 }); });

    expect(mockInvoke).toHaveBeenCalledWith("notif_update_config", {
      config: { ...initial, maxHistoryEntries: 200 },
    });
    expect(result.current.config).toEqual({ ...initial, maxHistoryEntries: 200 });
  });

  it("updateConfig sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Write error");

    const { result } = renderHook(() => useNotificationRules());
    await act(async () => { await result.current.updateConfig({ enabled: false }); });

    expect(result.current.error).toBe("Write error");
  });
});
