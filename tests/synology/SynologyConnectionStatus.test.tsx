import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import ConnectionForm from "../../src/components/synology/synologyPanel/ConnectionForm";
import type { Mgr } from "../../src/components/synology/synologyPanel/types";
import {
  useSynologyFileConnection,
  type SynologyFileConnectionOptions,
} from "../../src/hooks/synology/useSynologyFileConnection";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
beforeEach(() => vi.mocked(invoke).mockReset());
afterEach(cleanup);
const manager = (overrides: Partial<Mgr> = {}) =>
  ({
    targetLocked: true,
    host: "nas.example.test",
    port: 5001,
    username: "user",
    password: "secret",
    useHttps: true,
    otpCode: "",
    connectionStatus: "error",
    connectionError: "Connection refused by NAS",
    challenge: null,
    connect: vi.fn(),
    cancelChallenge: vi.fn(),
    ...overrides,
  }) as unknown as Mgr;
describe("saved NAS status page", () => {
  it("uses the app-themed password control and reveals only by explicit user action without submitting", () => {
    const mgr = manager({
      targetLocked: false,
      connectionError: null,
      setPassword: vi.fn(),
      setUsername: vi.fn(),
    });
    const view = render(<ConnectionForm mgr={mgr} />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveClass("sor-form-input");
    expect(password).toHaveStyle({ paddingRight: "2.25rem" });
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Username")).toHaveClass("sor-form-input");
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "autocomplete",
      "username",
    );
    const reveal = screen.getByRole("button", { name: "Show password" });
    expect(reveal).toHaveAttribute("type", "button");
    fireEvent.click(reveal);
    expect(password).toHaveAttribute("type", "text");
    expect(mgr.connect).not.toHaveBeenCalled();
    expect(mgr.setPassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    fireEvent.change(password, { target: { value: "replacement" } });
    expect(mgr.setPassword).toHaveBeenCalledExactlyOnceWith("replacement");
    view.rerender(
      <ConnectionForm mgr={{ ...mgr, connectionStatus: "connecting" }} />,
    );
    expect(password).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Show password" }),
    ).not.toBeInTheDocument();
  });
  it("keeps vault-locked credentials disabled and unrevealable", () => {
    render(
      <ConnectionForm
        mgr={manager({ targetLocked: false, credentialsLocked: true })}
      />,
    );
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.queryByRole("button", { name: "Show password" }),
    ).not.toBeInTheDocument();
  });
  it.each([true, false])(
    "renders structured safe API errors in the saved=%s connection form",
    (targetLocked) => {
      const data = {
        stage: "api_discovery",
        category: "html",
        httpStatus: 200,
        contentType: "html",
        bytesRead: 4096,
      };
      render(
        <ConnectionForm
          mgr={manager({
            targetLocked,
            connectionError: `Native explanation\nsynology-diagnostic:v1:${JSON.stringify(data)}`,
          })}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "web page instead of API JSON",
      );
      expect(screen.getByText("Discovering DSM APIs")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy diagnostics" }),
      ).toBeEnabled();
      expect(screen.queryByText(/synology-diagnostic/)).not.toBeInTheDocument();
    },
  );
  it("shows the actual failure and Retry without duplicate credential fields", () => {
    const mgr = manager();
    render(<ConnectionForm mgr={mgr} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connection refused by NAS",
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mgr.connect).toHaveBeenCalledOnce();
  });
  it("shows a cancellable connecting state instead of a login form", () => {
    const mgr = manager({
      connectionStatus: "connecting",
      connectionError: null,
    });
    render(<ConnectionForm mgr={mgr} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Resolving the NAS and signing in",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
    expect(mgr.cancelChallenge).toHaveBeenCalledOnce();
  });
  it("keeps the explicit two-factor popup, not a username/password prompt", () => {
    render(
      <ConnectionForm
        mgr={manager({
          connectionError: null,
          challenge: {
            status: "otp_required",
            message: "Enter your authenticator code.",
          },
        })}
      />,
    );
    expect(
      screen.getByRole("dialog", {
        name: "Synology two-factor authentication",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("One-time code")).toBeInTheDocument();
    expect(screen.getByLabelText("One-time code")).toHaveClass(
      "sor-form-input",
    );
    expect(screen.getByLabelText("One-time code")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
    expect(screen.getByLabelText("One-time code")).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
  it("shows code verification as one pending request inside the explicit challenge dialog", () => {
    render(
      <ConnectionForm
        mgr={manager({
          connectionStatus: "connecting",
          connectionError: null,
          challenge: {
            status: "otp_required",
            message: "Enter your authenticator code.",
          },
        })}
        runtimeVerified
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Verifying the one-time code…" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("DSM requested a one-time code"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("configured-app-loader")).toHaveLength(1);
    expect(
      screen.queryByText("DSM API session established"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("One-time code")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel sign-in" }),
    ).toBeEnabled();
  });
  it("replaces the old browser-only footnote with the Secure SignIn code and website fallback text", () => {
    render(
      <ConnectionForm
        mgr={manager({ targetLocked: false, connectionError: null })}
      />,
    );
    expect(
      screen.getByText(
        /The NAS API accepts DSM one-time codes from an authenticator app or Synology Secure SignIn\. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/security-key prompts require the DSM website/),
    ).not.toBeInTheDocument();
  });
});

const FALLBACK =
  "Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.";
/** Real connection hook driving the real form, so DSM results reach the DOM unchanged. */
function SavedNas(options: SynologyFileConnectionOptions) {
  const connection = useSynologyFileConnection(true, {
    instanceId: "saved-nas",
    initialConfig: {
      host: "nas.example.test",
      port: 5001,
      useHttps: true,
      username: "fixture-admin",
      password: "fixture-password",
    },
    ...options,
  });
  return (
    <>
      <span data-testid="status">{connection.connectionStatus}</span>
      <button
        onClick={() =>
          void connection.reconnect({ sessionProfile: "dsm_desktop" })
        }
      >
        Test reconnect as DSM session
      </button>
      <ConnectionForm mgr={connection as unknown as Mgr} />
    </>
  );
}
const scriptConnect = (...outcomes: unknown[]) => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "syn_fs_session_health")
      return {
        status: "connected",
        lastVerifiedAt: "",
        consecutiveFailures: 0,
        message: null,
      };
    return command === "syn_fs_connect" ? outcomes.shift() : true;
  });
};
const connectCount = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "syn_fs_connect").length;
const openChallenge = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  return screen.findByRole("dialog", {
    name: "Synology two-factor authentication",
  });
};

describe("NAS API two-factor dialog states", () => {
  it("406 shows setup guidance without a code field and never asks the vault authenticator", async () => {
    const resolveOtp = vi.fn();
    scriptConnect({ status: "otp_enrollment_required", message: "native" });
    render(<SavedNas resolveOtp={resolveOtp} />);
    const dialog = await openChallenge();
    expect(
      within(dialog).getByRole("heading", {
        name: "Two-factor setup required",
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "DSM requires this account to set up two-factor authentication before it can sign in. Complete setup once in DSM in your browser (the DSM website view works), then connect again.",
    );
    expect(within(dialog).queryByLabelText("One-time code")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Verify code" }),
    ).toBeNull();
    expect(resolveOtp).not.toHaveBeenCalled();
    expect(connectCount()).toBe(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByRole("dialog", {
        name: "Synology two-factor authentication",
      }),
    ).not.toBeInTheDocument();
    expect(connectCount()).toBe(1);
  });

  it("449 names Secure SignIn approval and security keys and points to the DSM website view", async () => {
    scriptConnect({
      status: "unsupported_mfa",
      message: "native",
      methods: ["secure_signin_approval", "security_key"],
    });
    render(<SavedNas />);
    const dialog = await openChallenge();
    expect(
      within(dialog).getByRole("heading", {
        name: "Sign-in method not supported",
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "This account uses Secure SignIn approval and a security key.",
    );
    expect(dialog).toHaveTextContent(FALLBACK);
    expect(
      within(dialog).getByTestId("synology-auth-methods"),
    ).toHaveTextContent(
      "Sign-in methods DSM reported for this account: Secure SignIn approval, Security key",
    );
    expect(within(dialog).queryByLabelText("One-time code")).toBeNull();
    expect(dialog).not.toHaveTextContent("native");
  });

  it("449 without reported methods still gives the website fallback", async () => {
    scriptConnect({ status: "unsupported_mfa", message: "native" });
    render(<SavedNas />);
    const dialog = await openChallenge();
    expect(dialog).toHaveTextContent(FALLBACK);
    expect(within(dialog).queryByTestId("synology-auth-methods")).toBeNull();
  });

  it("403 with an approval method combines the code prompt with the fallback, and a typed code connects", async () => {
    scriptConnect(
      {
        status: "otp_required",
        message: "native",
        methods: ["otp", "secure_signin_approval"],
      },
      { status: "otp_invalid", message: "native" },
      { status: "connected", sessionId: "receipt-ok", message: "ok" },
    );
    render(<SavedNas />);
    const dialog = await openChallenge();
    expect(
      within(dialog).getByRole("heading", {
        name: "Two-factor authentication",
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      `Enter the one-time code from your authenticator app or the code shown in Synology Secure SignIn. ${FALLBACK}`,
    );
    const code = within(dialog).getByLabelText("One-time code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify code" }),
    );
    await within(dialog).findByText(
      "The one-time code was not accepted. Enter a fresh code.",
    );
    fireEvent.change(within(dialog).getByLabelText("One-time code"), {
      target: { value: "654321" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify code" }),
    );
    await vi.waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    expect(connectCount()).toBe(3);
  });

  it("reconnect as DSM session opens the same code dialog and sends the profile with the code", async () => {
    scriptConnect(
      { status: "connected", sessionId: "receipt-old", message: "ok" },
      { status: "otp_required", message: "native" },
      { status: "connected", sessionId: "receipt-webui", message: "ok" },
    );
    render(<SavedNas />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Test reconnect as DSM session" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Synology two-factor authentication",
    });
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "saved-nas",
      expectedSessionId: "receipt-old",
    });
    fireEvent.change(within(dialog).getByLabelText("One-time code"), {
      target: { value: "246810" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify code" }),
    );
    await vi.waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("connected"),
    );
    const calls = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "syn_fs_connect")
      .map(([, args]) => args as Record<string, unknown>);
    expect(calls.map((args) => [args.otpCode, args.sessionProfile])).toEqual([
      [null, undefined],
      [null, "dsm_desktop"],
      ["246810", "dsm_desktop"],
    ]);
  });
});
