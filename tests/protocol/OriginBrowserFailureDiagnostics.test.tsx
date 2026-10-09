import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  OriginBrowserFailureDiagnostics,
  type OriginBrowserFailureDiagnosticsProps,
} from "../../src/components/protocol/webBrowser/OriginBrowserFailureDiagnostics";
import type { OriginBrowserState } from "../../src/hooks/protocol/useOriginBrowser";
import { originBrowserStartupError } from "../../src/hooks/protocol/originBrowserStartupError";
import type { OriginBrowserLoadFailure } from "../../src/types/protocols/originBrowser";

const writeText = vi.fn();
let accessible = true;
function props(): OriginBrowserFailureDiagnosticsProps {
  return {
    state: {
      phase: "error",
      unavailableReason: null,
      error: "RAW_NATIVE_ERROR password=TOP_SECRET",
      snapshot: {
        identity: {
          ownerDatabaseId: "PRIVATE_DB",
          connectionId: "PRIVATE_CONNECTION",
          sessionId: "PRIVATE_SESSION",
          attemptId: "PRIVATE_ATTEMPT",
        },
        sequence: 17,
        phase: "attached",
        displayUrl: "https://site.example/private-path",
        currentUrl:
          "https://site.example/private-path?token=QUERY_SECRET#FRAGMENT_SECRET",
        title: "PRIVATE_PAGE_TITLE",
        loadFailure: { code: -105, category: "dns" },
        loading: false,
        canGoBack: true,
        canGoForward: false,
      },
    },
    targetUrl:
      "https://URL_USERNAME:URL_PASSWORD@site.example/private-path?token=QUERY_SECRET#FRAGMENT_SECRET",
    active: true,
    ownerAvailable: true,
    assertOwner: vi.fn(() => {
      if (!accessible) throw new Error("OWNER_SECRET");
    }),
    onOpenDevTools: vi.fn().mockResolvedValue(true),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function assertNoSecrets(text: string) {
  for (const secret of [
    "RAW_NATIVE_ERROR",
    "TOP_SECRET",
    "PRIVATE_DB",
    "PRIVATE_CONNECTION",
    "PRIVATE_SESSION",
    "PRIVATE_ATTEMPT",
    "PRIVATE_PAGE_TITLE",
    "private-path",
    "URL_USERNAME",
    "URL_PASSWORD",
    "QUERY_SECRET",
    "FRAGMENT_SECRET",
    "OWNER_SECRET",
    "EXTRA_SECRET",
  ]) {
    expect(text).not.toContain(secret);
  }
}
beforeEach(() => {
  accessible = true;
  vi.clearAllMocks();
  vi.mocked(invoke).mockReset().mockResolvedValue({
    outcome: "response",
    elapsedMs: 24,
    httpStatus: 401,
    contentLength: 25,
  });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("native browser failure diagnostics", () => {
  it("shows and copies the safe engine failure and startup stage with recovery, without issuing a website probe", async () => {
    const p = props();
    p.state = {
      phase: "unavailable",
      snapshot: null,
      error: null,
      unavailableReason: "policy-unavailable",
      runtimeFailure: {
        code: "data-directory",
        stage: "preparing",
        message: "TOP_SECRET",
      } as never,
    };
    const onRecover = vi.fn();
    render(
      <OriginBrowserFailureDiagnostics
        {...p}
        onRecover={onRecover}
        recoveryAllowed
      />,
    );
    expect(screen.getByText("Browser startup diagnostics")).toBeVisible();
    expect(screen.getByText("engine-data-directory")).toBeVisible();
    expect(screen.getByText("preparing")).toBeVisible();
    expect(
      screen.getByText(
        /could not prepare or activate a usable working-data directory/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Run deep diagnostics" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("Failure code: engine-data-directory");
    expect(copied).toContain("Runtime startup stage: preparing");
    assertNoSecrets(copied);
    fireEvent.click(
      screen.getByRole("button", { name: "Open Web Browser settings" }),
    );
    expect(onRecover).toHaveBeenCalledWith("browser-settings");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("renders detailed themed browser facts, recovery and unmeasured network stages without sending a probe", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const p = props();
    render(
      <div role="alert">
        <button>Retry browser</button>
        <button>Repair two-factor authentication</button>
        <OriginBrowserFailureDiagnostics {...p} />
      </div>,
    );
    const alert = screen.getByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(
      within(alert).getByRole("button", { name: "Retry browser" }),
    ).toBeEnabled();
    expect(
      within(alert).getByRole("button", {
        name: "Repair two-factor authentication",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "Browser diagnostics" }),
    ).toHaveClass("bg-[var(--color-surface)]");
    expect(
      screen.getByRole("heading", {
        name: "The website name could not be resolved",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("-105 · NAME_NOT_RESOLVED")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("https://site.example")).toBeInTheDocument();
    expect(screen.getByText("Available / Unavailable")).toBeInTheDocument();
    const network = screen.getByRole("region", {
      name: "Deep network diagnostics",
    });
    for (const stage of ["DNS", "TCP", "TLS", "HTTP"])
      expect(within(network).getByText(stage)).toBeInTheDocument();
    expect(within(network).getAllByText("Probe not run")).toHaveLength(4);
    expect(
      within(network).getByText(/separate anonymous GET/),
    ).toBeInTheDocument();
    const probe = within(network).getByRole("button", {
      name: "Run deep diagnostics",
    });
    expect(probe).toBeEnabled();
    expect(network).toHaveTextContent("database-lock protections");
    expect(network).toHaveTextContent(
      "cannot fall back to a direct connection",
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(p.onOpenDevTools).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    assertNoSecrets(alert.textContent ?? "");
  });

  it.each([
    ["proxy", -130, "The browser could not connect to its private proxy"],
    ["proxy", -111, "The configured proxy route failed"],
    ["certificate", -202, "The website certificate was not accepted"],
    ["tls", -107, "The secure connection could not be negotiated"],
    ["blocked", -20, "The website request was blocked"],
    ["network-changed", -21, "The network changed during navigation"],
    ["http", -324, "The browser reported an HTTP request failure"],
  ] as const)(
    "provides category-specific recovery for %s",
    (category, code, title) => {
      const p = props();
      p.state.snapshot = {
        ...p.state.snapshot!,
        loadFailure: { category, code },
      };
      render(<OriginBrowserFailureDiagnostics {...p} />);
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`^${code}( · |$)`)),
      ).toBeInTheDocument();
      expect(
        screen
          .getByRole("region", { name: "Suggested recovery" })
          .querySelectorAll("li").length,
      ).toBeGreaterThan(1);
    },
  );

  it("copies only allowlisted origin and browser facts after an owner check", async () => {
    const p = props();
    p.state.snapshot = {
      ...p.state.snapshot!,
      loadFailure: {
        code: -105,
        category: "dns",
        extra: "EXTRA_SECRET",
      } as OriginBrowserLoadFailure,
    };
    render(<OriginBrowserFailureDiagnostics {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Diagnostics copied.",
      ),
    );
    expect(p.assertOwner).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledOnce();
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("CEF load error: -105");
    expect(text).toContain("Website origin: https://site.example");
    expect(text).toContain("HTTP response status: Not exposed");
    expect(text).toContain("Separate network probe: Not run");
    assertNoSecrets(text);
  });

  it("identifies invalid configuration fields and rules in the panel and sanitized copy", async () => {
    const p = props();
    p.state = {
      ...p.state,
      snapshot: null,
      configurationFailure: {
        issues: [
          "url-credentials",
          "expectedSecurityRevision:missing",
          "consent-kind",
        ],
      },
    };
    render(
      <OriginBrowserFailureDiagnostics
        {...p}
        onRecover={vi.fn()}
        recoveryAllowed
      />,
    );
    const details = screen.getByRole("region", { name: "What failed" });
    expect(within(details).getAllByRole("listitem")).toHaveLength(3);
    expect(details).toHaveTextContent("Starting website address");
    expect(details).toHaveTextContent(
      "embedded username or password information",
    );
    expect(details).toHaveTextContent("Database security revision is missing");
    expect(details).toHaveTextContent("login consent mode is not supported");
    for (const code of [
      "url-credentials",
      "expectedSecurityRevision:missing",
      "consent-kind",
    ])
      expect(within(details).getByText(code)).toBeInTheDocument();
    expect(
      within(details).getByRole("button", {
        name: "Review connection settings",
      }),
    ).toBeEnabled();
    expect(
      within(details).getByRole("button", { name: "Open database manager" }),
    ).toBeEnabled();
    expect(
      within(details).getByRole("button", {
        name: "Review application settings",
      }),
    ).toBeEnabled();
    assertNoSecrets(document.body.textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("What failed");
    expect(copied).toContain("Field / rule / stage: Starting website address");
    expect(copied).toContain("Failure code: url-credentials");
    expect(copied).toContain("embedded username or password information");
    expect(copied).toContain("Failure code: expectedSecurityRevision:missing");
    expect(copied).toContain("Next step: Review the connection address");
    expect(copied).toContain("Suggested action: Review connection settings");
    assertNoSecrets(copied);
  });

  it("explains saved website permission rejection with a direct guarded recovery action", () => {
    const p = props();
    p.state = {
      ...p.state,
      snapshot: null,
      startupFailure: originBrowserStartupError(
        "create",
        "Saved browser permission policy is invalid or unsupported",
      ),
    };
    const onRecover = vi.fn(() => expect(p.assertOwner).toHaveBeenCalledOnce());
    render(
      <OriginBrowserFailureDiagnostics
        {...p}
        onRecover={onRecover}
        recoveryAllowed
      />,
    );
    const details = screen.getByRole("region", { name: "What failed" });
    expect(details).toHaveTextContent(/permission/i);
    expect(details).toHaveTextContent(
      /not (?:provided|reported)|did not (?:provide|report)/i,
    );
    fireEvent.click(
      within(details).getByRole("button", {
        name: "Review website permissions",
      }),
    );
    expect(onRecover).toHaveBeenCalledExactlyOnceWith("permissions");
    expect(invoke).not.toHaveBeenCalled();
    expect(p.onOpenDevTools).not.toHaveBeenCalled();
    assertNoSecrets(document.body.textContent ?? "");
  });

  it("reports when the native failure cause was not provided", async () => {
    const p = props();
    p.state.snapshot = {
      ...p.state.snapshot!,
      phase: "failed",
      failureReason: undefined,
    };
    render(<OriginBrowserFailureDiagnostics {...p} />);
    const details = screen.getByRole("region", { name: "What failed" });
    expect(details).toHaveTextContent(
      "No supported structured cause was reported",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain(
      "No supported structured cause was reported",
    );
    assertNoSecrets(writeText.mock.calls[0][0]);
  });

  it("shows the exact rejected proxy field and rule with its dedicated recovery destination", async () => {
    const p = props();
    p.state = {
      ...p.state,
      snapshot: null,
      startupFailure: originBrowserStartupError(
        "create",
        "Saved browser policy rejected (connection.httpProxyPolicy): pageScripts must be allow when present",
      ),
    };
    const onRecover = vi.fn();
    render(
      <OriginBrowserFailureDiagnostics
        {...p}
        onRecover={onRecover}
        recoveryAllowed
      />,
    );
    const details = screen.getByRole("region", { name: "What failed" });
    expect(details).toHaveTextContent("connection.httpProxyPolicy");
    expect(details).toHaveTextContent("pageScripts");
    expect(details).toHaveTextContent("allow");
    fireEvent.click(
      within(details).getByRole("button", {
        name: "Review internal proxy controls",
      }),
    );
    expect(p.assertOwner).toHaveBeenCalledOnce();
    expect(onRecover).toHaveBeenCalledExactlyOnceWith("legacy-proxy");
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("connection.httpProxyPolicy");
    expect(copied).toContain("pageScripts");
    expect(copied).toContain("allow");
    expect(copied).toContain(
      "Suggested action: Review internal proxy controls",
    );
    assertNoSecrets(copied);
  });

  it("reports the failed operation and code without guessing which saved policy rejected it", async () => {
    const p = props();
    p.state = { ...p.state, snapshot: null, operationFailure: "navigation" };
    render(<OriginBrowserFailureDiagnostics {...p} />);
    const details = screen.getByRole("region", { name: "What failed" });
    expect(details).toHaveTextContent("Native navigation operation");
    expect(details).toHaveTextContent("operation-navigation");
    expect(details).toHaveTextContent(
      "did not report whether a permission, route, or session check rejected it",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain(
      "Failure code: operation-navigation",
    );
    expect(writeText.mock.calls[0][0]).toContain(
      "Field / rule / stage: Native navigation operation",
    );
    assertNoSecrets(writeText.mock.calls[0][0]);
  });

  it.each([
    [
      "connection.websiteDomainPermissions",
      "Review website permissions",
      "permissions",
    ],
    [
      "settings.webBrowser.domainPermissions",
      "Open Web Browser settings",
      "browser-settings",
    ],
  ] as const)(
    "preserves the rejected %s scope and opens its matching settings",
    async (scope, label, action) => {
      const p = props();
      p.state = {
        ...p.state,
        snapshot: null,
        startupFailure: originBrowserStartupError(
          "create",
          `Saved browser policy rejected (${scope}): version must be 1`,
        ),
      };
      const onRecover = vi.fn();
      render(
        <OriginBrowserFailureDiagnostics
          {...p}
          onRecover={onRecover}
          recoveryAllowed
        />,
      );
      const details = screen.getByRole("region", { name: "What failed" });
      expect(details).toHaveTextContent(`${scope}.version`);
      expect(details).toHaveTextContent("version must be 1");
      fireEvent.click(within(details).getByRole("button", { name: label }));
      expect(p.assertOwner).toHaveBeenCalledOnce();
      expect(onRecover).toHaveBeenCalledExactlyOnceWith(action);
      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      const copied = writeText.mock.calls[0][0] as string;
      expect(copied).toContain(`Field / rule / stage: ${scope}.version`);
      expect(copied).toContain(`Suggested action: ${label}`);
      assertNoSecrets(copied);
    },
  );

  it.each([
    "default",
    "disallowed",
    "inactive",
    "owner-locked",
    "callback-failed",
  ] as const)(
    "guards field recovery when %s without exposing exception text",
    (gate) => {
      const p = props();
      p.state = {
        ...p.state,
        snapshot: null,
        configurationFailure: { issues: ["url-scheme"] },
      };
      const onRecover = vi.fn(() => {
        if (gate === "callback-failed") throw new Error("EXTRA_SECRET");
      });
      render(
        <OriginBrowserFailureDiagnostics
          {...p}
          onRecover={onRecover}
          active={gate !== "inactive"}
          recoveryAllowed={
            gate === "default" ? undefined : gate !== "disallowed"
          }
        />,
      );
      const button = screen.getByRole("button", {
        name: "Review connection settings",
      });
      if (["default", "disallowed", "inactive"].includes(gate))
        expect(button).toBeDisabled();
      if (gate === "owner-locked") accessible = false;
      fireEvent.click(button);
      if (gate === "callback-failed") {
        expect(p.assertOwner).toHaveBeenCalledOnce();
        expect(onRecover).toHaveBeenCalledExactlyOnceWith("connection");
      } else {
        expect(onRecover).not.toHaveBeenCalled();
      }
      if (gate === "owner-locked" || gate === "callback-failed")
        expect(screen.getByRole("status")).toHaveTextContent(
          "Could not open the recovery settings",
        );
      assertNoSecrets(document.body.textContent ?? "");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("runs an anonymous canonical-origin probe on demand and displays and copies only safe scalar results", async () => {
    const p = props();
    const task = deferred<unknown>();
    vi.mocked(invoke).mockReturnValue(task.promise);
    render(<OriginBrowserFailureDiagnostics {...p} />);
    const button = screen.getByRole("button", { name: "Run deep diagnostics" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("origin_browser_diagnose", {
      request: {
        identity: p.state.snapshot!.identity,
        origin: "https://site.example",
      },
    });
    await act(async () => {
      task.resolve({
        outcome: "response",
        elapsedMs: 24,
        httpStatus: 401,
        contentLength: 25,
        body: "EXTRA_SECRET",
        url: p.targetUrl,
      });
      await task.promise;
    });
    expect(screen.getByText("401")).toBeInTheDocument();
    expect(screen.getByText("24 ms")).toBeInTheDocument();
    expect(screen.getByText("25 bytes")).toBeInTheDocument();
    expect(
      screen.getAllByText("Delegated to the private proxy; no separate timing"),
    ).toHaveLength(2);
    expect(screen.getByText(/HTTPS probe uses strict PKI/)).toBeInTheDocument();
    expect(
      screen.getByText(/does not test the failed page path or saved login/),
    ).toBeInTheDocument();
    expect(button).toBeEnabled();
    assertNoSecrets(
      screen.getByTestId("origin-browser-failure-diagnostics").textContent ??
        "",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain(
      "Anonymous probe HTTP status: 401",
    );
    expect(writeText.mock.calls[0][0]).toContain(
      "Anonymous probe elapsed: 24 ms",
    );
    expect(writeText.mock.calls[0][0]).toContain("strict PKI");
    assertNoSecrets(writeText.mock.calls[0][0]);
  });

  it("keeps unknown CEF codes numeric without accepting a supplied error name", () => {
    const p = props();
    p.state.snapshot = {
      ...p.state.snapshot!,
      loadFailure: {
        code: -999,
        category: "other",
        name: "EXTRA_SECRET",
      } as OriginBrowserLoadFailure,
    };
    render(<OriginBrowserFailureDiagnostics {...p} />);
    expect(screen.getByText("-999")).toBeInTheDocument();
    assertNoSecrets(
      screen.getByTestId("origin-browser-failure-diagnostics").textContent ??
        "",
    );
  });

  it.each([
    "javascript:alert('QUERY_SECRET')",
    "not a URL QUERY_SECRET",
    "data:text/plain,QUERY_SECRET",
  ])("does not echo an invalid diagnostic target: %s", async (targetUrl) => {
    render(
      <OriginBrowserFailureDiagnostics {...props()} targetUrl={targetUrl} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain(
      "Website origin: Not reported",
    );
    assertNoSecrets(writeText.mock.calls[0][0]);
  });

  it("ignores unknown failure fields instead of rendering or copying arbitrary payloads", async () => {
    const p = props();
    p.state.snapshot = {
      ...p.state.snapshot!,
      loadFailure: {
        code: -105,
        category: "EXTRA_SECRET",
      } as unknown as OriginBrowserLoadFailure,
    };
    p.state.startupFailure = {
      category: "EXTRA_SECRET",
      stage: "EXTRA_SECRET",
      code: "EXTRA_SECRET",
    } as unknown as OriginBrowserState["startupFailure"];
    p.state.configurationFailure = {
      issues: ["EXTRA_SECRET"],
    } as unknown as OriginBrowserState["configurationFailure"];
    p.state.operationFailure =
      "EXTRA_SECRET" as OriginBrowserState["operationFailure"];
    render(<OriginBrowserFailureDiagnostics {...p} />);
    expect(screen.queryByText("-105")).toBeNull();
    assertNoSecrets(
      screen.getByTestId("origin-browser-failure-diagnostics").textContent ??
        "",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    assertNoSecrets(writeText.mock.calls[0][0]);
  });

  it("leaves startup and MFA recovery in the same alert without inventing live-page capabilities", () => {
    const p = props();
    p.state = {
      ...p.state,
      snapshot: null,
      startupFailure: {
        stage: "create",
        category: "connection",
        reason: "mfa-origin-mismatch",
      },
    };
    render(
      <div role="alert">
        <button>Repair two-factor authentication</button>
        <OriginBrowserFailureDiagnostics {...p} />
      </div>,
    );
    expect(
      screen.getByRole("heading", {
        name: "Automatic two-factor authentication needs review",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Retry browser explicitly",
    );
    expect(
      screen.getByRole("button", { name: "Inspect failed page" }),
    ).toBeDisabled();
    const probe = screen.getByRole("button", { name: "Run deep diagnostics" });
    expect(probe).toBeDisabled();
    fireEvent.click(probe);
    expect(invoke).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /Startup and closed-session failures cannot reuse a verified route/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("create")).toBeInTheDocument();
    expect(screen.queryByText("-105")).toBeNull();
  });

  it("does not show recoverable load facts or enable DevTools for a fatal native fault", () => {
    const p = props();
    p.state.snapshot = {
      ...p.state.snapshot!,
      phase: "failed",
      failureReason: "renderer",
    };
    render(<OriginBrowserFailureDiagnostics {...p} />);
    expect(screen.getByText("renderer")).toBeInTheDocument();
    expect(screen.queryByText("-105")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Inspect failed page" }),
    ).toBeDisabled();
  });

  it("opens DevTools only for the current live attempt and reports a rejected action safely", async () => {
    const p = props();
    vi.mocked(p.onOpenDevTools!).mockResolvedValue(false);
    render(<OriginBrowserFailureDiagnostics {...p} />);
    expect(p.onOpenDevTools).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect failed page" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "could not be opened",
      ),
    );
    expect(p.onOpenDevTools).toHaveBeenCalledExactlyOnceWith();
    expect(p.assertOwner).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["Copy diagnostics", "Inspect failed page"])(
    "fences %s when the owner locks without a render",
    async (name) => {
      const p = props();
      render(<OriginBrowserFailureDiagnostics {...p} />);
      accessible = false;
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(/could not/i),
      );
      expect(writeText).not.toHaveBeenCalled();
      expect(p.onOpenDevTools).not.toHaveBeenCalled();
      assertNoSecrets(screen.getByRole("status").textContent ?? "");
    },
  );

  it("hides facts for an unavailable owner and disables actions in an inactive tab", () => {
    const p = props();
    const view = render(
      <OriginBrowserFailureDiagnostics {...p} active={false} />,
    );
    expect(
      screen.getByRole("button", { name: "Copy diagnostics" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Inspect failed page" }),
    ).toBeDisabled();
    view.rerender(
      <OriginBrowserFailureDiagnostics {...p} ownerAvailable={false} />,
    );
    expect(
      screen.queryByTestId("origin-browser-failure-diagnostics"),
    ).toBeNull();
    expect(screen.getByText(/Unlock the owning database/)).toBeInTheDocument();
    expect(screen.queryByText("https://site.example")).toBeNull();
  });

  it("exposes only database recovery when the owner is unavailable", () => {
    const p = props();
    const onRecover = vi.fn();
    accessible = false;
    render(
      <OriginBrowserFailureDiagnostics
        {...p}
        ownerAvailable={false}
        onRecover={onRecover}
        recoveryAllowed
      />,
    );
    const button = screen.getByRole("button", {
      name: "Open database manager",
    });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button).toBeEnabled();
    expect(screen.queryByRole("region", { name: "What failed" })).toBeNull();
    expect(screen.queryByText("https://site.example")).toBeNull();
    assertNoSecrets(document.body.textContent ?? "");
    fireEvent.click(button);
    expect(onRecover).toHaveBeenCalledExactlyOnceWith("database");
    expect(p.assertOwner).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(p.onOpenDevTools).not.toHaveBeenCalled();
  });

  it.each(["default", "disallowed", "inactive"] as const)(
    "keeps unavailable-owner database recovery disabled when %s",
    (gate) => {
      const onRecover = vi.fn();
      render(
        <OriginBrowserFailureDiagnostics
          {...props()}
          ownerAvailable={false}
          onRecover={onRecover}
          active={gate !== "inactive"}
          recoveryAllowed={gate === "default" ? undefined : gate === "inactive"}
        />,
      );
      const button = screen.getByRole("button", {
        name: "Open database manager",
      });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(onRecover).not.toHaveBeenCalled();
    },
  );

  it("redacts a rejected unavailable-owner database recovery", () => {
    render(
      <OriginBrowserFailureDiagnostics
        {...props()}
        ownerAvailable={false}
        recoveryAllowed
        onRecover={() => {
          throw new Error("EXTRA_SECRET");
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open database manager" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not open the recovery settings",
    );
    assertNoSecrets(document.body.textContent ?? "");
  });

  it.each([
    "attempt",
    "configuration",
    "operation",
    "lock",
    "inactive",
    "unmount",
  ])("drops late DevTools results after %s changes", async (change) => {
    const task = deferred<boolean>();
    const p = props();
    vi.mocked(p.onOpenDevTools!).mockReturnValue(task.promise);
    const view = render(<OriginBrowserFailureDiagnostics {...p} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect failed page" }),
    );
    expect(p.onOpenDevTools).toHaveBeenCalledOnce();
    if (change === "attempt")
      view.rerender(
        <OriginBrowserFailureDiagnostics
          {...p}
          state={{
            ...p.state,
            snapshot: {
              ...p.state.snapshot!,
              identity: {
                ...p.state.snapshot!.identity,
                attemptId: "NEW_ATTEMPT",
              },
            },
          }}
        />,
      );
    if (change === "lock")
      view.rerender(
        <OriginBrowserFailureDiagnostics {...p} ownerAvailable={false} />,
      );
    if (change === "configuration")
      view.rerender(
        <OriginBrowserFailureDiagnostics
          {...p}
          state={{
            ...p.state,
            configurationFailure: { issues: ["url-scheme"] },
          }}
        />,
      );
    if (change === "operation")
      view.rerender(
        <OriginBrowserFailureDiagnostics
          {...p}
          state={{ ...p.state, operationFailure: "navigation" }}
        />,
      );
    if (change === "inactive")
      view.rerender(<OriginBrowserFailureDiagnostics {...p} active={false} />);
    if (change === "unmount") view.unmount();
    await act(async () => {
      task.resolve(true);
      await task.promise;
    });
    expect(
      screen.queryByText("DevTools opened for this browser attempt."),
    ).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("suppresses duplicate clipboard actions and redacts clipboard failures", async () => {
    const task = deferred<void>();
    writeText.mockReturnValue(task.promise);
    const view = render(<OriginBrowserFailureDiagnostics {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(writeText).toHaveBeenCalledOnce();
    await act(async () => {
      task.resolve();
      await task.promise;
    });
    expect(screen.getByRole("status")).toHaveTextContent("Diagnostics copied.");
    view.unmount();
    writeText.mockRejectedValue(new Error("EXTRA_SECRET"));
    render(<OriginBrowserFailureDiagnostics {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Could not copy diagnostics",
      ),
    );
    assertNoSecrets(screen.getByRole("status").textContent ?? "");
  });
});
