import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";

const root = "src-tauri/crates/sorng-protocols/src/";
const native = readFileSync(root + "autologin_asset.rs", "utf8");
const selection = native
  .split("fn staged_autologin_clients(")[1]
  ?.split("pub fn autologin_client_asset_script_for_mode")[0];
if (!selection) throw new Error("Native staged selection is missing");
// Execute the includes chosen by the actual Rust match, rather than a second
// hand-maintained adapter selection in the browser harness.
const modes = new Map<string, string[]>();
for (const arm of selection.matchAll(
  /((?:UpstreamAuthMode::\w+\s*\|?\s*)+) =>\s*&\[([^\]]*)\]/g,
)) {
  const clients = arm[2]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const mode of arm[1].matchAll(/UpstreamAuthMode::(\w+)/g))
    modes.set(mode[1], clients);
}
const globals: Record<string, string> = {
  BITWARDEN_CLIENT_JS: "__sorng_bitwarden_login",
  SYNOLOGY_CLIENT_JS: "__sorng_synology_login",
  GOOGLE_CLIENT_JS: "__sorng_google_login",
  CLOUDFLARE_CLIENT_JS: "__sorng_cloudflare_login",
  YEALINK_CLIENT_JS: "__sorng_yealink_login",
  ADOBE_CLIENT_JS: "__sorng_adobe_login",
  AI_CHAT_CLIENT_JS: "__sorng_ai_chat_form",
  CHATGPT_CLIENT_JS: "__sorng_chatgpt_login",
  CLAUDE_CLIENT_JS: "__sorng_claude_login",
};
type Coordinator = {
  fetchCredsAndRun(
    nonce: string,
    selectors?: object | null,
    flow?: string | null,
  ): Promise<unknown> | undefined;
  cancel(): void;
};
let coordinator: Coordinator | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
function install(mode: string) {
  const clients = modes.get(mode);
  if (!clients) throw new Error(`Native mode not found: ${mode}`);
  window.eval(loadAutologinClient(process.cwd(), clients));
  coordinator = Reflect.get(window, "__sorng_autologin") as Coordinator;
  return coordinator;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  coordinator?.cancel();
  if (coordinator) {
    window.removeEventListener("pagehide", coordinator.cancel);
    window.removeEventListener("unload", coordinator.cancel);
  }
  for (const key of Object.values(globals))
    Reflect.get(window, key)?.cancel?.();
  for (const key of [
    ...Object.values(globals),
    "__sorng_autologin",
    "__autologin_last",
  ])
    Reflect.deleteProperty(window, key);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  coordinator = undefined;
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("native mode-scoped auto-login assets", () => {
  it("keeps the shipping selection inside the authorized bootstrap gate", () => {
    expect(modes.size).toBe(14);
    const http = readFileSync(root + "http.rs", "utf8");
    const gate = http.split("let autologin_asset =")[1].split("};")[0];
    expect(gate).toContain("if autologin_script.is_empty()");
    expect(gate).toContain("String::new()");
    expect(gate).toContain("autologin_client_asset_script_for_mode(");
    expect(gate).toContain("autologin_asset_mode(&state)");
    expect(gate).not.toContain("autologin_client_asset_script()");
    expect(http).toContain(
      'format!("{}{}{}", nav_script, autologin_asset, autologin_script)',
    );
  });

  it.each([...modes])(
    "installs only the selected staged globals for %s without redeeming credentials",
    (mode, clients) => {
      const client = install(mode);
      expect(typeof client.fetchCredsAndRun).toBe("function");
      for (const [name, global] of Object.entries(globals))
        expect(Reflect.has(window, global), `${mode}: ${name}`).toBe(
          clients.includes(name),
        );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["SynologyForm", "synology", "SYNOLOGY_CLIENT_JS", "runWhenReady"],
    ["GoogleForm", "google", "GOOGLE_CLIENT_JS", "runWhenReady"],
    [
      "GoogleForm",
      "google-password",
      "GOOGLE_CLIENT_JS",
      "runPasswordWhenReady",
    ],
    ["CloudflareForm", "cloudflare", "CLOUDFLARE_CLIENT_JS", "runWhenReady"],
    ["YealinkServlet", "yealink-t20p", "YEALINK_CLIENT_JS", "runWhenReady"],
    ["AdobeForm", "adobe", "ADOBE_CLIENT_JS", "runWhenReady"],
    ["ChatgptForm", "chatgpt", "CHATGPT_CLIENT_JS", "runWhenReady"],
    [
      "ChatgptForm",
      "chatgpt-password",
      "CHATGPT_CLIENT_JS",
      "runPasswordWhenReady",
    ],
    ["ClaudeForm", "claude", "CLAUDE_CLIENT_JS", "runWhenReady"],
  ])(
    "dispatches %s / %s to the installed adapter once",
    async (mode, flow, name, method) => {
      const client = install(mode);
      const adapter = Reflect.get(window, globals[name]);
      const result = { ok: true, reason: "selected-adapter" };
      const dispatch = vi.spyOn(adapter, method).mockResolvedValue(result);
      expect(await client.fetchCredsAndRun("page-nonce", null, flow)).toEqual(
        result,
      );
      expect(dispatch).toHaveBeenCalledWith(
        "page-nonce",
        expect.objectContaining({
          fillField: expect.any(Function),
          report: expect.any(Function),
        }),
      );
      await client.fetchCredsAndRun("another-nonce", null, flow);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("keeps Bitwarden metadata dispatch without a bootstrap flow hint and clears its transport secrets", async () => {
    const client = install("BitwardenForm");
    const response = {
      loginFlow: "bitwarden",
      username: "fixture-user",
      password: "fixture-password",
      continuation: "fixture-continuation",
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => response });
    let received: unknown;
    const dispatch = vi
      .spyOn(Reflect.get(window, "__sorng_bitwarden_login"), "run")
      .mockImplementation((data) => {
        received = structuredClone(data);
        return Promise.resolve({ ok: true });
      });
    await client.fetchCredsAndRun("page-nonce");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(received).toMatchObject({
      loginFlow: "bitwarden",
      username: "fixture-user",
      continuation: "fixture-continuation",
    });
    expect(response).toEqual({
      loginFlow: "bitwarden",
      username: null,
      password: null,
      continuation: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/__sortofremoteng_autologin?nonce=page-nonce",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    await client.fetchCredsAndRun("another-nonce");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([undefined, "cpanel"])(
    "does not load an unselected staged adapter from response metadata (flow=%s)",
    async (flow) => {
      const client = install("None");
      const response = {
        loginFlow: "bitwarden",
        username: "fixture-user",
        password: "fixture-password",
        continuation: "fixture-continuation",
      };
      fetchMock.mockResolvedValue({ ok: true, json: async () => response });
      await client.fetchCredsAndRun("page-nonce", null, flow);
      expect(Reflect.get(window, "__autologin_last")).toEqual({
        ok: false,
        reason: flow ? "invalid-login-flow" : "autologin-client-unavailable",
      });
      for (const global of Object.values(globals))
        expect(Reflect.has(window, global)).toBe(false);
      expect(response.password).toBeNull();
      expect(response.continuation).toBeNull();
    },
  );
});
