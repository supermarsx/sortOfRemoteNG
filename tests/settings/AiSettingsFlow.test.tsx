import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiSettings from "../../src/components/SettingsDialog/sections/AiSettings";
import {
  defaultProviderConfig,
  type LlmConfig,
  type ProviderConfig,
} from "../../src/types/llm";
import type { IntegrationInstance } from "../../src/hooks/integrations/useIntegrationConfigStore";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reload: vi.fn(),
  instances: [] as IntegrationInstance[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => mocks.invoke(command, args),
  isTauri: () => true,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
  }),
}));
vi.mock("../../src/hooks/integrations/useIntegrationConfigStore", () => ({
  useIntegrationConfigStore: () => ({
    instances: mocks.instances,
    isLoading: false,
    error: null,
    readSecretState: mocks.read,
    createInstance: mocks.create,
    updateInstance: mocks.update,
    deleteInstance: mocks.remove,
    reload: mocks.reload,
  }),
}));

let providers: ProviderConfig[];
let config: LlmConfig;
const provider = (): ProviderConfig => ({
  ...defaultProviderConfig(),
  id: "work",
  display_name: "Work provider",
  base_url: "https://original.example/v1",
  api_key: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.instances = [];
  mocks.read.mockResolvedValue({ status: "loaded", value: "saved-secret" });
  mocks.create.mockResolvedValue({ id: "new-instance" });
  mocks.update.mockResolvedValue(undefined);
  providers = [];
  config = {
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
  };
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "llm_list_providers") return providers;
    if (command === "llm_get_config") return structuredClone(config);
    if (command === "llm_add_provider") {
      providers = [...providers, args.config];
      config.default_provider ??= args.config.id;
      return;
    }
    if (command === "llm_update_config") {
      config = args.config;
      return;
    }
    if (command === "llm_update_provider") return;
    if (command === "llm_set_default_provider") {
      config.default_provider = args.providerId;
      return;
    }
    if (command === "llm_remove_provider") {
      providers = providers.filter((p) => p.id !== args.providerId);
      if (config.default_provider === args.providerId)
        config.default_provider = null;
      return true;
    }
    if (command === "llm_chat_completion")
      return { choices: [{ message: { content: "Hello from fixture" } }] };
    if (command === "llm_estimate_tokens") return 12;
    return null;
  });
});
async function ready() {
  const view = render(<AiSettings />);
  await screen.findByRole("heading", { name: "1. Connect your providers" });
  return view;
}
function field(key: string) {
  const element = document.querySelector<HTMLInputElement>(
    `[data-setting-key="${key}"]`,
  );
  if (!element) throw new Error(`Missing ${key}`);
  return element;
}
function set(key: string, value: string) {
  fireEvent.change(field(key), { target: { value } });
}
function savedProvider() {
  providers = [provider()];
  mocks.instances = [
    {
      id: "instance",
      name: "Work provider",
      integrationKey: "llm",
      credentialRefId: "key-ref",
      fields: { config: JSON.stringify(provider()) },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ];
}

describe("AI setup workflow", () => {
  it("refreshes the default provider after adding the first provider and removing it", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    set("llm.provider.displayName", "First provider");
    set("llm.provider.apiKey", "fixture-key");
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    await waitFor(() =>
      expect(
        screen.getByText("Default provider").parentElement,
      ).toHaveTextContent("First provider"),
    );
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove First provider" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Default provider").parentElement,
      ).not.toHaveTextContent("First provider"),
    );
    expect(config.default_provider).toBeNull();
    confirmation.mockRestore();
  });
  it("preserves a newly selected default provider when applying an existing routing draft", async () => {
    providers = [provider()];
    await ready();
    fireEvent.click(screen.getByText("2. Routing & defaults"));
    set("llm.router.defaultModel", "draft-model");
    fireEvent.click(screen.getByRole("button", { name: "Set default" }));
    await waitFor(() =>
      expect(
        screen.getByText("Default provider").parentElement,
      ).toHaveTextContent("Work provider"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply routing" }));
    await screen.findByText("Applied to this app session");
    expect(config).toMatchObject({
      default_provider: "work",
      default_model: "draft-model",
    });
  });
  it("searches enabled provider names and sends the selected ID for a test request", async () => {
    providers = [
      provider(),
      {
        ...provider(),
        id: "disabled",
        display_name: "Disabled provider",
        enabled: false,
      },
    ];
    await ready();
    fireEvent.click(screen.getByText("Test your setup"));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Provider (optional)" }),
    );
    expect(
      screen.getByRole("option", { name: "Automatic (default provider)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Disabled provider" }),
    ).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Search options" }), {
      target: { value: "Work" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Work provider" }));
    set("llm.playground.model", "fixture-model");
    set("llm.playground.prompt", "hello");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Hello from fixture");
    expect(mocks.invoke).toHaveBeenCalledWith("llm_chat_completion", {
      request: expect.objectContaining({ provider_id: "work" }),
    });
  });
  it("waits for delayed backend initialization before revealing the requested search setting", async () => {
    let resolve!: (value: LlmConfig) => void;
    const implementation = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) =>
      command === "llm_get_config"
        ? new Promise<LlmConfig>((done) => {
            resolve = done;
          })
        : implementation(command, args),
    );
    const warning = vi.spyOn(console, "warn");
    render(<AiSettings highlightKey="llm.cache.ttlSeconds" />);
    await screen.findByText("Loading AI configuration…");
    await act(async () => {
      await new Promise((done) => setTimeout(done, 150));
    });
    expect(warning).not.toHaveBeenCalled();
    await act(async () => resolve(config));
    await waitFor(() =>
      expect(field("llm.cache.ttlSeconds")).toHaveAttribute(
        "data-testid",
        "settings-search-highlight",
      ),
    );
    expect(field("llm.cache.ttlSeconds").closest("details")).toHaveAttribute(
      "open",
    );
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });
  it("fails once without reading saved keys or registering providers, then recovers on Retry", async () => {
    savedProvider();
    providers = [];
    const implementation = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) =>
      command === "llm_get_config"
        ? Promise.reject(new Error("Command llm_get_config not found"))
        : implementation(command, args),
    );
    render(<AiSettings />);
    await screen.findByText("AI backend unavailable");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "llm_get_config",
      ),
    ).toHaveLength(1);
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "llm_add_provider",
      ),
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Save provider" })).toBeNull();
    mocks.invoke.mockImplementation(implementation);
    fireEvent.click(screen.getByRole("button", { name: "Retry AI setup" }));
    await screen.findByRole("heading", { name: "1. Connect your providers" });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(
      document.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Default provider").parentElement,
    ).toHaveTextContent("Work provider");
  });
  it("keeps routing edits local and preserves the draft after an apply failure", async () => {
    await ready();
    fireEvent.click(screen.getByText("2. Routing & defaults"));
    set("llm.router.defaultModel", "one");
    set("llm.router.defaultModel", "two");
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "llm_update_config",
      ),
    ).toBe(false);
    const implementation = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) =>
      command === "llm_update_config"
        ? Promise.reject(new Error("Router write rejected"))
        : implementation(command, args),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply routing" }));
    await screen.findByText("Router write rejected");
    expect(field("llm.router.defaultModel")).toHaveValue("two");
    expect(screen.getByText("Unapplied changes")).toBeInTheDocument();
    mocks.invoke.mockImplementation(implementation);
    fireEvent.click(screen.getByRole("button", { name: "Apply routing" }));
    await screen.findByText("Applied to this app session");
    expect(config.default_model).toBe("two");
  });
  it("keeps a saved key for same-scope edits without prefilling the field", async () => {
    savedProvider();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(field("llm.provider.apiKey")).toHaveValue("");
    expect(mocks.read).not.toHaveBeenCalled();
    set("llm.provider.displayName", "Renamed provider");
    fireEvent.click(screen.getByRole("button", { name: "Update provider" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.invoke).toHaveBeenCalledWith("llm_update_provider", {
      config: expect.objectContaining({
        api_key: "saved-secret",
        display_name: "Renamed provider",
      }),
    });
    expect(mocks.update.mock.calls[0][1].fields.config).not.toContain(
      "saved-secret",
    );
    expect(mocks.update.mock.calls[0][1].secret).toBeUndefined();
  });
  it("does not reuse a saved key after changing the endpoint", async () => {
    savedProvider();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    set("llm.provider.baseUrl", "https://different.example/v1");
    fireEvent.click(screen.getByRole("button", { name: "Update provider" }));
    await screen.findByText(/credential destination changed/);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "llm_update_provider",
      ),
    ).toBe(false);
    set("llm.provider.apiKey", "replacement-secret");
    fireEvent.click(screen.getByRole("button", { name: "Update provider" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("llm_update_provider", {
      config: expect.objectContaining({ api_key: "replacement-secret" }),
    });
  });
  it("supports zero retries and exposes persistence failures without closing the form", async () => {
    mocks.create.mockRejectedValue(new Error("Credential storage locked"));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    set("llm.provider.apiKey", "new-secret");
    set("llm.provider.maxRetries", "0");
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    await screen.findByText(
      /could not be saved for restart.*Credential storage locked/,
    );
    expect(field("llm.provider.apiKey")).toHaveValue("new-secret");
    expect(field("llm.provider.type").closest("details")).toHaveAttribute(
      "open",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("llm_add_provider", {
      config: expect.objectContaining({ max_retries: 0 }),
    });
  });
  it("reveals nested search anchors without resetting drafts", async () => {
    await ready();
    const anchor = field("llm.provider.maxRetries");
    set("llm.provider.maxRetries", "7");
    act(() => anchor.setAttribute("data-testid", "settings-search-highlight"));
    await waitFor(() =>
      expect(anchor.closest("details")).toHaveAttribute("open"),
    );
    expect(
      anchor.closest("details")?.parentElement?.closest("details"),
    ).toHaveAttribute("open");
    expect(anchor).toHaveValue("7");
    const cache = field("llm.cache.ttlSeconds");
    act(() => cache.setAttribute("data-testid", "settings-search-highlight"));
    await waitFor(() =>
      expect(cache.closest("details")).toHaveAttribute("open"),
    );
    expect(
      cache.closest("details")?.parentElement?.closest("details"),
    ).toHaveAttribute("open");
  });
  it("keeps provider removal named and test actions explicit", async () => {
    savedProvider();
    await ready();
    expect(
      screen.getByRole("button", { name: "Remove Work provider" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Test your setup"));
    set("llm.playground.model", "fixture-model");
    set("llm.playground.prompt", "hello");
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "llm_chat_completion",
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Hello from fixture");
    set("llm.playground.tokenText", "test text");
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await screen.findByText("tokens: 12");
  });
});
