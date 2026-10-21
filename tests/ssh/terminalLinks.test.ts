import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { requestPrompt } from "../../src/utils/prompts/promptQueue";
import {
  canOpenTerminalLink,
  normalizeTerminalLink,
  openTerminalLink,
} from "../../src/utils/ssh/terminalLinks";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
vi.mock("../../src/utils/prompts/promptQueue", () => ({
  requestPrompt: vi.fn(),
}));

describe("terminal link security", () => {
  let enabled: unknown;
  const allowed = () => canOpenTerminalLink("ssh", enabled);
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    enabled = false;
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(requestPrompt).mockResolvedValue({
      confirmed: true,
      remember: false,
    });
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([undefined, null, false, 0, 1, "true", "false", {}, []])(
    "denies SSH opt-in value %j without a prompt or opener",
    async (value) => {
      enabled = value;
      await openTerminalLink(
        "https://example.test/",
        "detected",
        allowed,
        onError,
      );
      await openTerminalLink("https://example.test/", "osc8", allowed, onError);
      expect(window.confirm).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    },
  );

  it.each(["http://example.test/", "https://example.test/path?q=test"])(
    "opens opted-in detected URL %s through the native safe opener",
    async (url) => {
      enabled = true;
      await openTerminalLink(url, "detected", allowed, onError);
      expect(invoke).toHaveBeenCalledWith("open_url_external", { url });
      expect(window.confirm).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    },
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///C:/secret",
    "ftp://example.test/",
    "mailto:user@example.test",
    "ssh://example.test/",
    "//example.test/",
    "/relative",
    "https://",
    "https://user:password@example.test/",
    "https://user@example.test/",
    "https://example.test/\nnext",
    " https://example.test/",
    "https://example.test\\@evil.test/",
    "https://example.test/\u202esecret",
    `https://example.test/${"x".repeat(8192)}`,
  ])(
    "rejects unsafe URLs for both detected and OSC8 routes (%s)",
    async (url) => {
      enabled = true;
      expect(normalizeTerminalLink(url)).toBeNull();
      for (const source of ["detected", "osc8"] as const) {
        await openTerminalLink(url, source, allowed, onError);
      }
      expect(window.confirm).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    },
  );

  it("confirms the actual OSC8 destination and respects cancellation", async () => {
    enabled = true;
    vi.mocked(requestPrompt).mockResolvedValue({
      confirmed: false,
      remember: false,
    });
    await openTerminalLink(
      "https://destination.test/path",
      "osc8",
      allowed,
      onError,
    );
    expect(requestPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultAction: "cancel",
        preview: {
          label: "Destination",
          text: "https://destination.test/path",
        },
      }),
      { signal: undefined },
    );
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(requestPrompt).mockResolvedValue({
      confirmed: true,
      remember: false,
    });
    await openTerminalLink(
      "https://destination.test/path",
      "osc8",
      allowed,
      onError,
    );
    expect(invoke).toHaveBeenCalledWith("open_url_external", {
      url: "https://destination.test/path",
    });
  });

  it("rechecks the current opt-in after destination confirmation", async () => {
    enabled = true;
    vi.mocked(requestPrompt).mockImplementation(async () => {
      enabled = false;
      return { confirmed: true, remember: false };
    });
    await openTerminalLink("https://example.test/", "osc8", allowed, onError);
    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("never falls back after native failure or exposes the native error", async () => {
    enabled = true;
    vi.mocked(invoke).mockRejectedValue(new Error("URL contains secret-token"));
    await openTerminalLink(
      "https://example.test/?token=secret-token",
      "detected",
      allowed,
      onError,
    );
    expect(window.open).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      "Unable to open the terminal link in your browser.",
    );
    expect(JSON.stringify(onError.mock.calls)).not.toContain("secret-token");
  });

  it("uses a no-opener browser fallback only outside Tauri", async () => {
    enabled = true;
    vi.mocked(isTauri).mockReturnValue(false);
    await openTerminalLink(
      "https://example.test/",
      "detected",
      allowed,
      onError,
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      "https://example.test/",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not apply the SSH-specific opt-in to other terminal protocols", async () => {
    await openTerminalLink(
      "https://example.test/",
      "osc8",
      () => canOpenTerminalLink("telnet", false),
      onError,
    );
    expect(requestPrompt).toHaveBeenCalledOnce();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("fails closed without a prompt host and never uses a native dialog", async () => {
    enabled = true;
    vi.mocked(requestPrompt).mockRejectedValue(new Error("host unavailable"));
    await openTerminalLink("https://example.test/", "osc8", allowed, onError);
    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      "Unable to open the terminal link in your browser.",
    );
  });

  it("does not open after its owner aborts while confirmation is pending", async () => {
    enabled = true;
    const controller = new AbortController();
    vi.mocked(requestPrompt).mockImplementation(async () => {
      controller.abort();
      return { confirmed: true, remember: false };
    });
    await openTerminalLink(
      "https://example.test/",
      "osc8",
      allowed,
      onError,
      controller.signal,
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
