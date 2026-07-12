import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

// The secret vault is not present under vitest.
vi.mock("../../../utils/storage/storage", () => ({
  SecureStorage: {
    vaultStoreSecret: vi.fn().mockResolvedValue(undefined),
    vaultReadSecret: vi.fn().mockResolvedValue(null),
    vaultDeleteSecret: vi.fn().mockResolvedValue(undefined),
  },
}));

import AiSettings from "./AiSettings";
import { llmApi } from "../../../hooks/integration/useLlm";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "write_app_data":
        return Promise.resolve(null);
      case "llm_list_providers":
        return Promise.resolve([]);
      case "llm_get_config":
        return Promise.resolve({
          default_provider: null,
          default_model: null,
          cache: {
            enabled: true,
            max_entries: 1000,
            ttl_seconds: 3600,
            max_memory_mb: 256,
            cache_embeddings: true,
            cache_tool_calls: false,
          },
          balancer: {
            strategy: "priority",
            health_check_interval_seconds: 300,
            failover_enabled: true,
            sticky_sessions: false,
          },
          usage_tracking_enabled: true,
          cost_alerts: [],
          model_aliases: {},
          fallback_chain: [],
        });
      case "llm_add_provider":
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  });
});

describe("AiSettings (LLM router fold)", () => {
  it("loads the live router state on mount (list providers + get config)", async () => {
    render(<AiSettings />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("llm_list_providers", undefined));
    expect(invokeMock).toHaveBeenCalledWith("llm_get_config", undefined);
    expect(screen.getByTestId("section-ai")).toBeInTheDocument();
    expect(
      screen.getByText("No providers configured"),
    ).toBeInTheDocument();
  });

  it("adds a provider through the form, mapping to llm_add_provider with a snake_case config", async () => {
    render(<AiSettings />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("llm_list_providers", undefined),
    );

    // Open the add-provider form.
    fireEvent.click(screen.getByRole("button", { name: /^Add provider$/i }));

    fireEvent.change(screen.getByPlaceholderText("OpenAI"), {
      target: { value: "My OpenAI" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-secret" },
    });

    // Click the form's submit button (the second "Add provider").
    const addButtons = screen.getAllByRole("button", { name: /Add provider/i });
    fireEvent.click(addButtons[addButtons.length - 1]);

    await waitFor(() =>
      expect(
        invokeMock.mock.calls.some((c) => c[0] === "llm_add_provider"),
      ).toBe(true),
    );

    const call = invokeMock.mock.calls.find((c) => c[0] === "llm_add_provider");
    const config = (call?.[1] as { config: Record<string, unknown> }).config;
    expect(config.provider_type).toBe("open_ai");
    expect(config.display_name).toBe("My OpenAI");
    expect(config.api_key).toBe("sk-secret");
    expect(config.enabled).toBe(true);
  });

  it("exposes the full 20-command surface via llmApi", () => {
    // Guards against accidental removal of a bound command.
    const keys = Object.keys(llmApi);
    expect(keys).toHaveLength(20);
    for (const k of [
      "addProvider",
      "removeProvider",
      "updateProvider",
      "listProviders",
      "setDefaultProvider",
      "chatCompletion",
      "createEmbedding",
      "listModels",
      "modelsForProvider",
      "modelInfo",
      "healthCheck",
      "healthCheckAll",
      "usageSummary",
      "cacheStats",
      "clearCache",
      "status",
      "getConfig",
      "updateConfig",
      "setBalancerStrategy",
      "estimateTokens",
    ]) {
      expect(keys).toContain(k);
    }
  });
});
