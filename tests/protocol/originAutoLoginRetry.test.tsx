import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Connection } from "../../src/types/connection/connection";
import type { NativeLoginActivity } from "../../src/hooks/protocol/useNativeLoginActivity";
import {
  nextFreshCodeAtMs,
  ORIGIN_BROWSER_RETRY_LOGIN_COMMAND,
  originAutoLoginRetryConfiguration,
  originBrowserRetryLoginRefusals,
  parseRetryLoginReceipt,
  useOriginAutoLoginRetry,
  type OriginAutoLoginRetryOptions,
} from "../../src/hooks/protocol/useOriginAutoLoginRetry";
import { autoLoginRetryMessage } from "../../src/utils/protocol/autoLoginRetryMessages";
import OriginAutoLoginRetryControls from "../../src/components/protocol/webBrowser/OriginAutoLoginRetryControls";

const events = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, listener) => {
    events.listener = listener;
    return () => {};
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: { seconds?: number }) =>
      fallback.replace("{{seconds}}", String(values?.seconds)),
  }),
}));

const TOTP_ID = "11234567-89ab-4cde-8fab-0123456789ab";
const form = {
  id: "c1",
  password: "saved",
  httpApplication: { version: 1, id: "gitea", loginMode: "form" },
} as Connection;
const withMfa = {
  ...form,
  httpAutoMfa: { version: 1, enabled: true, totpConfigId: TOTP_ID },
  totpConfigs: [
    {
      id: TOTP_ID,
      secret: "S",
      issuer: "",
      account: "",
      digits: 6,
      period: 30,
      algorithm: "sha1",
    },
  ],
} as Connection;
const activity = (
  stage: NativeLoginActivity["stage"],
  extra: Partial<NativeLoginActivity> = {},
): NativeLoginActivity => ({
  connectionId: "c1",
  sessionId: "s1",
  attemptId: "a1",
  stage,
  timestampMs: 1,
  elapsedMs: 1,
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("auto-login retry configuration", () => {
  it("offers retry only where native would sign in automatically", () => {
    expect(originAutoLoginRetryConfiguration(undefined).enabled).toBe(false);
    expect(
      originAutoLoginRetryConfiguration({
        ...form,
        httpApplication: { version: 1, id: "gitea", loginMode: "manual" },
      }).enabled,
    ).toBe(false);
    expect(
      originAutoLoginRetryConfiguration({
        id: "c",
        password: "p",
        httpAutoLogin: true,
      } as Connection),
    ).toMatchObject({ enabled: true, credentials: true, mfa: false });
    expect(
      originAutoLoginRetryConfiguration({
        id: "c",
        password: "p",
      } as Connection).enabled,
    ).toBe(false);
  });

  it("needs a saved credential and a selected authenticator", () => {
    expect(
      originAutoLoginRetryConfiguration({ ...form, password: "" }),
    ).toMatchObject({ enabled: true, credentials: false, mfa: false });
    expect(
      originAutoLoginRetryConfiguration({
        ...form,
        password: undefined,
        credentialSource: { kind: "vault", credentialId: "v" },
      }).credentials,
    ).toBe(true);
    expect(originAutoLoginRetryConfiguration(withMfa)).toMatchObject({
      credentials: true,
      mfa: true,
      periodSeconds: 30,
    });
    expect(
      originAutoLoginRetryConfiguration({
        ...withMfa,
        httpAutoMfa: { version: 1, enabled: false, totpConfigId: TOTP_ID },
      }).mfa,
    ).toBe(false);
    expect(
      originAutoLoginRetryConfiguration({
        ...withMfa,
        totpConfigs: [{ ...withMfa.totpConfigs![0], period: 60 }],
      }).periodSeconds,
    ).toBe(60);
  });

  it("waits for the code period after the one a code was typed in", () => {
    expect(nextFreshCodeAtMs(undefined, 30)).toBe(0);
    expect(nextFreshCodeAtMs(30_000, 30)).toBe(60_000);
    expect(nextFreshCodeAtMs(59_999, 30)).toBe(60_000);
    expect(nextFreshCodeAtMs(61_000, 60)).toBe(120_000);
  });
});

const IDENTITY = {
  ownerDatabaseId: "db",
  connectionId: "c1",
  sessionId: "s1",
  attemptId: "a1",
};

describe("useOriginAutoLoginRetry", () => {
  const base = (
    patch: Partial<OriginAutoLoginRetryOptions> = {},
  ): OriginAutoLoginRetryOptions => ({
    connection: withMfa,
    activity: undefined,
    identity: IDENTITY,
    attached: true,
    transport: vi.fn(async () => ({ status: "started" })),
    now: () => 100_000,
    ...patch,
  });

  it("retries each step in place through the native retry command only", async () => {
    const transport = vi.fn(async () => ({ status: "started" }));
    const onOutcome = vi.fn();
    const { result } = renderHook(() =>
      useOriginAutoLoginRetry(
        base({
          transport,
          onOutcome,
          identity: { ...IDENTITY, extra: "dropped" } as typeof IDENTITY,
        }),
      ),
    );
    expect(result.current.credentials).toEqual({
      available: true,
      reason: null,
    });
    await act(async () => {
      expect(await result.current.retry("credentials")).toEqual({
        status: "started",
      });
    });
    await act(async () => {
      await result.current.retry("mfa");
    });
    expect(transport.mock.calls).toEqual([
      [{ identity: IDENTITY, step: "credentials" }],
      [{ identity: IDENTITY, step: "mfa" }],
    ]);
    expect(onOutcome.mock.calls).toEqual([
      ["credentials", { status: "started" }],
      ["mfa", { status: "started" }],
    ]);
  });

  it("uses the native retry command by default", async () => {
    const core = await import("@tauri-apps/api/core");
    vi.mocked(core.invoke).mockResolvedValueOnce({
      status: "refused",
      reason: "code-used",
    });
    const { result } = renderHook(() =>
      useOriginAutoLoginRetry(base({ transport: undefined })),
    );
    await act(async () => {
      expect(await result.current.retry("mfa")).toEqual({
        status: "refused",
        reason: "code-used",
      });
    });
    expect(core.invoke).toHaveBeenCalledExactlyOnceWith(
      ORIGIN_BROWSER_RETRY_LOGIN_COMMAND,
      { request: { identity: IDENTITY, step: "mfa" } },
    );
  });

  it("keeps only fixed receipt codes and reports a missing command as unavailable", async () => {
    expect(parseRetryLoginReceipt({ status: "started", x: 1 })).toEqual({
      status: "started",
    });
    expect(
      parseRetryLoginReceipt({ status: "refused", reason: "no-form" }),
    ).toEqual({ status: "refused", reason: "no-form" });
    for (const value of [
      null,
      "started",
      { status: "refused", reason: "private page text" },
      { status: "done" },
    ])
      expect(parseRetryLoginReceipt(value)).toEqual({ status: "unavailable" });
    const transport = vi.fn(async () => {
      throw new Error("Command origin_browser_retry_login not found");
    });
    const onOutcome = vi.fn();
    const { result } = renderHook(() =>
      useOriginAutoLoginRetry(base({ transport, onOutcome })),
    );
    await act(async () => {
      expect(await result.current.retry("credentials")).toEqual({
        status: "unavailable",
      });
    });
    expect(onOutcome).toHaveBeenCalledWith("credentials", {
      status: "unavailable",
    });
    expect(result.current.pending).toBe(false);
  });

  it("allows one retry at a time", async () => {
    let finish!: (value: unknown) => void;
    const transport = vi.fn(
      () => new Promise<unknown>((resolve) => (finish = resolve)),
    );
    const { result } = renderHook(() =>
      useOriginAutoLoginRetry(base({ transport })),
    );
    let first!: Promise<unknown>;
    act(() => {
      first = result.current.retry("credentials");
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.credentials.reason).toBe("busy");
    await act(async () => {
      expect(await result.current.retry("mfa")).toBeNull();
    });
    await act(async () => {
      finish({ status: "refused", reason: "busy" });
      await first;
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  it("is disabled without saved secrets, while entering text, or without an attached page", async () => {
    const transport = vi.fn(async () => ({ status: "started" }));
    const { result, rerender } = renderHook(
      (props: OriginAutoLoginRetryOptions) => useOriginAutoLoginRetry(props),
      { initialProps: base({ connection: form, transport }) },
    );
    expect(result.current.mfa).toEqual({ available: false, reason: "no-mfa" });
    await act(async () => {
      expect(await result.current.retry("mfa")).toBeNull();
    });
    for (const patch of [
      { activity: activity("filling-password") },
      { activity: activity("typing-code") },
      { attached: false },
      { identity: null },
    ]) {
      rerender(base({ ...patch, transport }));
      expect(result.current.credentials.reason).toBe("busy");
    }
    rerender(base({ activity: activity("waiting-2fa"), transport }));
    expect(result.current.mfa.available).toBe(true);
    rerender(base({ connection: { ...form, password: "" }, transport }));
    expect(result.current.credentials.reason).toBe("no-credentials");
    expect(transport).not.toHaveBeenCalled();
  });

  it("never asks for 2FA again in a code period whose code was already typed", async () => {
    vi.useFakeTimers();
    let clock = 100_000;
    const transport = vi.fn(async () => ({ status: "started" }));
    const { result } = renderHook(() =>
      useOriginAutoLoginRetry(
        base({
          transport,
          now: () => clock,
          activity: activity("completed", { codeTypedAtMs: 95_000 }),
        }),
      ),
    );
    // Typed in [90 s, 120 s): the next fresh code starts at 120 s.
    expect(result.current.mfa.reason).toBe("wait");
    // Credentials are not a code: they can be retried right away.
    expect(result.current.credentials.available).toBe(true);
    expect(result.current.waitSeconds).toBe(20);
    await act(async () => {
      expect(await result.current.retry("mfa")).toBeNull();
    });
    clock = 119_000;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.waitSeconds).toBe(1);
    clock = 120_000;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.mfa).toEqual({ available: true, reason: null });
    await act(async () => {
      await result.current.retry("mfa");
    });
    expect(transport).toHaveBeenCalledExactlyOnceWith({
      identity: IDENTITY,
      step: "mfa",
    });
  });
});

describe("autoLoginRetryMessage", () => {
  const t = ((_key: string, fallback: string) => fallback) as never;
  it("words every outcome without native text or reconnect wording", () => {
    expect(
      autoLoginRetryMessage(t, "credentials", { status: "started" }),
    ).toEqual({
      type: "info",
      message: "Retrying automatic login on this page.",
    });
    expect(autoLoginRetryMessage(t, "mfa", { status: "started" }).message).toBe(
      "Entering a new 2FA code on this page.",
    );
    expect(
      autoLoginRetryMessage(t, "mfa", { status: "unavailable" }).type,
    ).toBe("error");
    for (const reason of originBrowserRetryLoginRefusals) {
      const line = autoLoginRetryMessage(t, "mfa", {
        status: "refused",
        reason,
      });
      expect(line.type).toBe("warning");
      expect(line.message.trim()).not.toBe("");
      expect(line.message).not.toMatch(/reconnect|reload|start page/i);
    }
  });

  it("tells a page on another address apart from a page without a form", () => {
    // The reported DSM case: the sign-in page was open, and the old single
    // code claimed it showed no sign-in form.
    const other = autoLoginRetryMessage(t, "credentials", {
      status: "refused",
      reason: "other-address",
    }).message;
    const noForm = autoLoginRetryMessage(t, "credentials", {
      status: "refused",
      reason: "no-form",
    }).message;
    expect(other).not.toBe(noForm);
    expect(other).toMatch(/saved sign-in addresses/);
    expect(other).not.toMatch(/no sign-in form/i);
    // "No form" is the outcome of a search, never of an address check.
    expect(noForm).toMatch(/looked for it/);
    expect(
      parseRetryLoginReceipt({ status: "refused", reason: "other-address" }),
    ).toEqual({ status: "refused", reason: "other-address" });
  });

  it("knows exactly the native refusal codes", () => {
    const native = readFileSync(
      resolve(__dirname, "../../src-tauri/src/origin_browser_login.rs"),
      "utf8",
    );
    const block = native.split("impl RetryRefusal {")[1].split("\n}\n")[0];
    const codes = [...block.matchAll(/=> "([a-z-]+)"/g)].map(
      ([, code]) => code,
    );
    expect([...codes].sort()).toEqual(
      [...originBrowserRetryLoginRefusals].sort(),
    );
  });

  it("has both refusal lines in every locale, English matching the fallback", () => {
    const dir = resolve(__dirname, "../../src/i18n/locales");
    const fallback = (key: string) =>
      autoLoginRetryMessage(
        ((_key: string, text: string) => text) as never,
        "credentials",
        {
          status: "refused",
          reason: key === "otherAddress" ? "other-address" : "no-form",
        },
      ).message;
    for (const file of readdirSync(dir).filter((name) =>
      name.endsWith(".json"),
    )) {
      const refused = JSON.parse(readFileSync(resolve(dir, file), "utf8"))
        .originBrowser.autoLoginRetry.refused;
      for (const key of ["otherAddress", "noForm"]) {
        expect(typeof refused[key], `${file} ${key}`).toBe("string");
        expect(refused[key].trim(), `${file} ${key}`).not.toBe("");
        if (file === "en-US.json") expect(refused[key]).toBe(fallback(key));
      }
      expect(refused.otherAddress).not.toBe(refused.noForm);
    }
  });
});

describe("a retry that waits for its form", () => {
  const base = (
    patch: Partial<OriginAutoLoginRetryOptions> = {},
  ): OriginAutoLoginRetryOptions => ({
    connection: withMfa,
    activity: undefined,
    identity: IDENTITY,
    attached: true,
    now: () => 100_000,
    ...patch,
  });
  it("stays busy while native looks, then reports what the search found", async () => {
    const answers: Array<(value: unknown) => void> = [];
    const transport = vi.fn(
      () => new Promise<unknown>((resolve) => answers.push(resolve)),
    );
    const onOutcome = vi.fn();
    const { result } = renderHook(() =>
      useOriginAutoLoginRetry(base({ transport, onOutcome })),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.retry("credentials");
    });
    // Native is still inside the first attempt's detection bound.
    expect(result.current.credentials).toEqual({
      available: false,
      reason: "busy",
    });
    await act(async () => {
      // A form that rendered late within the wait: the retry started.
      answers[0]({ status: "started" });
      expect(await pending).toEqual({ status: "started" });
    });
    expect(onOutcome).toHaveBeenLastCalledWith("credentials", {
      status: "started",
    });
    act(() => {
      pending = result.current.retry("credentials");
    });
    await act(async () => {
      // The whole bound passed without a form.
      answers[1]({ status: "refused", reason: "no-form" });
      expect(await pending).toEqual({ status: "refused", reason: "no-form" });
    });
    expect(result.current.pending).toBe(false);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("OriginAutoLoginRetryControls", () => {
  let transport: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  beforeEach(() => {
    transport = vi.fn(async () => ({ status: "started" }));
  });
  function Harness(
    props: Partial<OriginAutoLoginRetryOptions> & { onRetry?: () => void },
  ) {
    const { onRetry, ...options } = props;
    const controller = useOriginAutoLoginRetry({
      connection: withMfa,
      activity: undefined,
      identity: IDENTITY,
      attached: true,
      transport,
      now: () => 100_000,
      ...options,
    });
    return (
      <OriginAutoLoginRetryControls controller={controller} onRetry={onRetry} />
    );
  }

  it("renders nothing for connections without automatic login", () => {
    render(
      <Harness
        connection={{
          ...form,
          httpAutoLogin: false,
          httpApplication: undefined,
        }}
      />,
    );
    expect(screen.queryByTestId("origin-auto-login-retry")).toBeNull();
  });

  it("labels both retry buttons, shows no reconnect notice, and retries after closing the panel", async () => {
    const onRetry = vi.fn();
    render(<Harness onRetry={onRetry} />);
    const row = screen.getByTestId("origin-auto-login-retry");
    expect(row.textContent).not.toMatch(/reconnect|start page|reload/i);
    const credentials = screen.getByRole("button", {
      name: "Retry automatic login with the saved credentials",
    });
    const mfa = screen.getByRole("button", {
      name: "Retry automatic login with a new 2FA code",
    });
    expect(credentials.getAttribute("data-tooltip")).toBe(
      "Retry automatic login with the saved credentials",
    );
    expect(credentials).toHaveProperty("disabled", false);
    await act(async () => {
      fireEvent.click(mfa);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledExactlyOnceWith({
      identity: IDENTITY,
      step: "mfa",
    });
  });

  it("explains why a step cannot be retried", () => {
    render(
      <Harness activity={activity("completed", { codeTypedAtMs: 95_000 })} />,
    );
    const mfa = screen.getByRole("button", {
      name: /Retry automatic login with a new 2FA code/,
    });
    expect(mfa).toHaveProperty("disabled", true);
    expect(mfa.getAttribute("data-tooltip")).toBe(
      "A new 2FA code is available in 20 s.",
    );
    cleanup();
    render(<Harness connection={form} />);
    const noMfa = screen.getByRole("button", {
      name: /new 2FA code/,
    });
    expect(noMfa).toHaveProperty("disabled", true);
    expect(noMfa.getAttribute("data-tooltip")).toBe(
      "No authenticator is selected for automatic 2FA on this connection.",
    );
    fireEvent.click(noMfa);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("native login activity code time", () => {
  it("remembers the last typed code across a replacement attempt", async () => {
    const { useNativeLoginActivity } =
      await import("../../src/hooks/protocol/useNativeLoginActivity");
    const { result } = renderHook(() => useNativeLoginActivity(["s1"]));
    await act(async () => {});
    const emit = (stage: string, timestampMs: number, attemptId = "a1") =>
      act(() => {
        events.listener!({
          payload: {
            connectionId: "c1",
            sessionId: "s1",
            attemptId,
            stage,
            timestampMs,
            elapsedMs: 0,
          },
        });
      });
    emit("waiting-2fa", 10);
    expect(result.current.s1.codeTypedAtMs).toBeUndefined();
    emit("typing-code", 20);
    emit("completed", 30);
    expect(result.current.s1.codeTypedAtMs).toBe(20);
    emit("stopped", 40);
    emit("waiting-page", 50, "a2");
    expect(result.current.s1).toMatchObject({
      attemptId: "a2",
      codeTypedAtMs: 20,
    });
    emit("typing-code", 60, "a2");
    expect(result.current.s1.codeTypedAtMs).toBe(60);
  });
});
