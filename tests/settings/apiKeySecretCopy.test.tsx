import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AuthenticationSection } from "../../src/components/SettingsDialog/sections/apiSettings/AuthenticationSection";
import { useApiSettings } from "../../src/hooks/settings/useApiSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  hasTick,
  installSecureClipboard,
  lockedSentence,
  watchConsole,
  type SecureClipboardFake,
} from "../security/secretCopyHarness";

const bridge = vi.hoisted(() => ({ getInvoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: bridge.getInvoke,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Synthetic: no real key is ever revealed in this file.
const KEY = "REST-KEY-SYNTHETIC-1";
const settings = { restApi: {} } as GlobalSettings;
const secretStatus = {
  vaultAvailable: true,
  apiKeyAvailable: true,
  jwtSecretAvailable: true,
  revealAvailable: true,
};

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;
/** How the next `api_reveal_key` calls answer. */
let reveal: Mock<() => Promise<string>>;
const reveals = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "api_reveal_key").length;

type Mgr = ReturnType<typeof useApiSettings>;
/** The hook starts several dynamic imports at once on mount, and under
 * Vitest the secret status among them does not load. This waits for the last
 * command of that mount sequence and then refreshes until the status is in,
 * so no import of the hook is still in flight when a test starts. */
async function loadSecretStatus(mgr: () => Mgr) {
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "set_api_disabled_capabilities",
      expect.anything(),
    ),
  );
  await waitFor(async () => {
    await act(() => mgr().refreshApiSecretStatus());
    expect(mgr().apiSecretStatus).toEqual(secretStatus);
  });
}
async function mountHook() {
  const hook = renderHook(() => useApiSettings(settings, vi.fn()));
  await loadSecretStatus(() => hook.result.current);
  return hook.result;
}
/** Ask the hook to copy and return what it told the row. */
async function copyWith(hook: { current: Mgr }) {
  let copied!: boolean;
  await act(async () => {
    copied = await hook.current.copyApiKey();
  });
  return copied;
}

let section: Mgr;
function Section() {
  section = useApiSettings(settings, vi.fn());
  return <AuthenticationSection settings={settings} mgr={section} />;
}
const copyButton = () => screen.getByRole("button", { name: "Copy key" });
async function mountSection() {
  render(<Section />);
  await loadSecretStatus(() => section);
}
const settled = () => act(async () => {});

describe("REST API key: copy", () => {
  beforeEach(() => {
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
    reveal = vi.fn<() => Promise<string>>().mockResolvedValue(KEY);
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "api_reveal_key"
        ? reveal()
        : command === "api_secret_status"
          ? secretStatus
          : command === "api_server_status"
            ? { running: false, bindAddr: "", port: 0, authRequired: true }
            : [],
    );
  });
  afterEach(() => {
    try {
      clipboard.expectNoRawClipboard();
      logs.expectSilentAbout(KEY);
    } finally {
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("copies the revealed key as an API key through the secure clipboard", async () => {
    const hook = await mountHook();
    expect(await copyWith(hook)).toBe(true);
    clipboard.expectOnlyCopy({ value: KEY, kind: "apiKey", field: "apiKey" });
    expect(hook.current.apiSecretError).toBeNull();
  });

  it("reports why a refused write failed, without the key", async () => {
    const hook = await mountHook();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    expect(await copyWith(hook)).toBe(false);
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(hook.current.apiSecretError).toBe(lockedSentence);
  });

  it("clears an earlier failure once a copy succeeds", async () => {
    const hook = await mountHook();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    await copyWith(hook);
    expect(hook.current.apiSecretError).toBe(lockedSentence);
    expect(await copyWith(hook)).toBe(true);
    expect(hook.current.apiSecretError).toBeNull();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
  });

  it("writes nothing, and says so to the row, when the key could not be revealed", async () => {
    const hook = await mountHook();
    reveal.mockRejectedValueOnce(new Error("Reauthentication was cancelled."));
    expect(await copyWith(hook)).toBe(false);
    expect(hook.current.apiSecretError).toBe("Reauthentication was cancelled.");
    reveal.mockRejectedValueOnce("denied");
    expect(await copyWith(hook)).toBe(false);
    expect(hook.current.apiSecretError).toBe(
      "Biometric API-key reveal was not available.",
    );
    reveal.mockResolvedValueOnce("");
    expect(await copyWith(hook)).toBe(false);
    expect(hook.current.apiSecretError).toBe("The secure API key was empty.");
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
  });

  it("shows the tick in the settings row only after the write succeeded", async () => {
    await mountSection();
    const write = clipboard.hold();
    fireEvent.click(copyButton());
    await waitFor(() => expect(clipboard.secureCopy).toHaveBeenCalledOnce());
    expect(hasTick(copyButton())).toBe(false);
    await act(async () => write.release());
    await waitFor(() => expect(hasTick(copyButton())).toBe(true));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows why a refused write failed in the settings row, with no tick and no key", async () => {
    await mountSection();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyButton());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(lockedSentence),
    );
    await settled();
    expect(screen.getByRole("alert")).not.toHaveTextContent(KEY);
    expect(hasTick(copyButton())).toBe(false);
  });

  it("shows no tick in the settings row when the key could not be revealed", async () => {
    await mountSection();
    reveal.mockRejectedValueOnce(new Error("Reauthentication was cancelled."));
    fireEvent.click(copyButton());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Reauthentication was cancelled.",
      ),
    );
    await settled();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expect(hasTick(copyButton())).toBe(false);
  });

  it("reveals and writes once when the row is clicked again while a copy is in flight", async () => {
    await mountSection();
    let answer!: (key: string) => void;
    reveal.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        answer = resolve;
      }),
    );
    fireEvent.click(copyButton());
    await waitFor(() => expect(reveals()).toBe(1));
    // A click while the reveal is pending, then one while the write is.
    fireEvent.click(copyButton());
    const write = clipboard.hold();
    await act(async () => answer(KEY));
    await waitFor(() => expect(clipboard.secureCopy).toHaveBeenCalledOnce());
    fireEvent.click(copyButton());
    await settled();
    expect(reveals()).toBe(1);
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(hasTick(copyButton())).toBe(false);
    await act(async () => write.release());
    await waitFor(() => expect(hasTick(copyButton())).toBe(true));
    // The row accepts the next copy as soon as the first has settled.
    fireEvent.click(copyButton());
    await waitFor(() => expect(clipboard.secureCopy).toHaveBeenCalledTimes(2));
    expect(reveals()).toBe(2);
  });
});
