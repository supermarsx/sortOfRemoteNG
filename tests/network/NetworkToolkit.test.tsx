import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkToolkit } from "../../src/components/network/toolkit/NetworkToolkit";
import {
  NETWORK_TOOL_IDS,
  type ToolkitReport,
} from "../../src/types/network/networkToolkit";

const mock = vi.hoisted(() => ({
  state: {
    report: null as ToolkitReport | null,
    error: null as string | null,
    running: false,
    run: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
  },
  profiles: [] as {
    id: string;
    name: string;
    url: string;
    disabled: boolean;
    reason?: string;
  }[],
  listener: null as (() => void) | null,
  unsubscribe: vi.fn(),
}));
vi.mock("../../src/hooks/network/useNetworkToolkit", () => ({
  useNetworkToolkit: () => mock.state,
}));
vi.mock("../../src/utils/network/networkToolkitProfiles", () => ({
  getToolkitProxyProfiles: () => mock.profiles,
}));
vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    subscribe: (listener: () => void) => {
      mock.listener = listener;
      return mock.unsubscribe;
    },
  },
}));

beforeEach(() => {
  mock.state.report = null;
  mock.state.error = null;
  mock.state.running = false;
  mock.state.run.mockReset().mockResolvedValue(undefined);
  mock.state.cancel.mockReset();
  mock.state.clear.mockReset();
  mock.profiles = [];
  mock.listener = null;
  mock.unsubscribe.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected browser networking");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const onClose = vi.fn();
  return {
    ...render(<NetworkToolkit isOpen embedded onClose={onClose} />),
    onClose,
  };
}
function tool(label: string) {
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "Network tools" })).getByRole(
      "button",
      { name: label },
    ),
  );
}
function input(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
function run() {
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
}
const report = (
  jobId = "job-1",
  data: unknown = { address: "192.0.2.1", reachable: true },
): ToolkitReport => ({
  jobId,
  tool: "ping",
  route: "direct",
  startedAt: "2026-10-07T12:00:00Z",
  durationMs: 15,
  data,
});

describe("Network Toolkit UI", () => {
  it("shows all 26 grouped tools using themed controls and never probes on mount", () => {
    const { container } = setup();
    expect(
      [...container.querySelectorAll("[data-tool-id]")]
        .map((element) => element.getAttribute("data-tool-id"))
        .sort(),
    ).toEqual([...NETWORK_TOOL_IDS].sort());
    for (const name of [
      "Connectivity",
      "DNS",
      "Web & Mail",
      "Local & Discovery",
    ])
      expect(screen.getByRole("region", { name })).toBeVisible();
    expect(screen.getByTestId("network-toolkit")).toHaveClass(
      "bg-[var(--color-background)]",
    );
    expect(screen.getByTestId("network-toolkit")).toHaveClass(
      "h-full",
      "min-h-0",
    );
    expect(screen.getByTestId("network-toolkit")).not.toHaveClass(
      "max-h-[85vh]",
      "min-h-[24rem]",
    );
    expect(screen.getByLabelText("Search tools")).toHaveClass(
      "sor-form-input-sm",
    );
    expect(screen.getByRole("button", { name: "Run" })).toHaveClass(
      "sor-btn-primary-sm",
    );
    expect(
      screen.getByRole("combobox", { name: "Routing for this tool" }),
    ).toHaveTextContent("Choose a route");
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("[title]")).toBeNull();
    expect(mock.state.run).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    input("Search tools", "blocklist");
    expect(
      screen.getByRole("button", { name: "Domain / DNS blocklist" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Ping" })).toBeNull();
    tool("Domain / DNS blocklist");
    expect(screen.getByText(/“dnl bl” is interpreted/)).toBeVisible();
  });

  it("does not mount a hidden panel and supports the themed modal", () => {
    const view = render(<NetworkToolkit isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId("network-toolkit")).toBeNull();
    expect(mock.listener).toBeNull();
    view.rerender(<NetworkToolkit isOpen onClose={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: "Network Toolkit" }),
    ).toBeVisible();
    expect(
      screen
        .getByRole("dialog", { name: "Network Toolkit" })
        .querySelector(".sor-modal-content"),
    ).toHaveClass("h-[85vh]");
    expect(mock.state.run).not.toHaveBeenCalled();
  });

  it("requires an explicit route and preserves a separate choice for each tool", async () => {
    setup();
    input("Target hostname or IP address", "example.org");
    run();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose Direct or HTTP proxy explicitly",
    );
    expect(mock.state.run).not.toHaveBeenCalled();
    choose("Routing for this tool", "Direct / local network");
    run();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled(),
    );
    expect(mock.state.run.mock.lastCall?.[0]).toMatchObject({
      tool: "ping",
      route: "direct",
      target: "example.org",
      timeoutMs: 5000,
    });
    tool("HTTP request");
    expect(
      screen.getByRole("combobox", { name: "Routing for this tool" }),
    ).toHaveTextContent("Choose a route");
    choose("Routing for this tool", "HTTP proxy");
    input("HTTP proxy URL", "http://127.0.0.1:8080");
    tool("Ping");
    expect(
      screen.getByRole("combobox", { name: "Routing for this tool" }),
    ).toHaveTextContent("Direct / local");
    tool("HTTP request");
    expect(screen.getByLabelText("HTTP proxy URL")).toHaveValue(
      "http://127.0.0.1:8080",
    );
    expect(
      screen.getByRole("combobox", { name: "Routing for this tool" }),
    ).toHaveTextContent("HTTP proxy");
  });

  it("disables proxy selection for direct-only protocols without falling back", () => {
    setup();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Routing for this tool" }),
    );
    const proxy = screen.getByRole("option", {
      name: "HTTP proxy — unsupported",
    });
    expect(proxy).toHaveAttribute("aria-disabled", "true");
    fireEvent.mouseDown(proxy);
    expect(
      screen.getByRole("combobox", { name: "Routing for this tool" }),
    ).toHaveTextContent("Choose a route");
    expect(mock.state.run).not.toHaveBeenCalled();
  });

  it("maps only supported saved profiles, supports manual URLs, and rejects profile changes", async () => {
    mock.profiles = [
      {
        id: "safe",
        name: "Office",
        url: "http://proxy.example:8080",
        disabled: false,
      },
      {
        id: "auth",
        name: "Authenticated",
        url: "",
        disabled: true,
        reason: "Authentication is unsupported.",
      },
    ];
    setup();
    tool("HTTP request");
    input("HTTP(S) URL", "https://example.org");
    choose("Routing for this tool", "HTTP proxy");
    fireEvent.click(
      screen.getByRole("combobox", { name: "Saved proxy profile" }),
    );
    expect(
      screen.getByRole("option", { name: /Authenticated/ }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Office" }));
    expect(screen.getByLabelText("HTTP proxy URL")).toHaveValue(
      "http://proxy.example:8080",
    );
    mock.profiles = [
      {
        ...mock.profiles[0],
        disabled: true,
        reason: "Authentication is now required.",
      },
    ];
    act(() => mock.listener?.());
    run();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "profile changed or is unavailable",
    );
    expect(mock.state.run).not.toHaveBeenCalled();
    input("HTTP proxy URL", "https://manual.example:8443");
    run();
    await waitFor(() => expect(mock.state.run).toHaveBeenCalledOnce());
    expect(mock.state.run.mock.lastCall?.[0]).toMatchObject({
      route: "httpProxy",
      proxyUrl: "https://manual.example:8443",
    });
  });

  it("validates proxy credentials and timeout before invoking a tool", async () => {
    setup();
    tool("HTTP request");
    input("HTTP(S) URL", "https://example.org");
    choose("Routing for this tool", "HTTP proxy");
    input("HTTP proxy URL", "http://user:password@proxy.example:8080");
    run();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "without embedded usernames or passwords",
    );
    input("HTTP proxy URL", "http://proxy.example:8080");
    input("Timeout (ms)", "499");
    run();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "between 500 and 60000",
    );
    expect(mock.state.run).not.toHaveBeenCalled();
    input("Timeout (ms)", "500");
    run();
    await waitFor(() => expect(mock.state.run).toHaveBeenCalledOnce());
  });

  it("runs exact local hash text without asking for a route and warns on legacy hashes", async () => {
    setup();
    tool("Hash calculator");
    expect(
      screen.queryByRole("combobox", { name: "Routing for this tool" }),
    ).toBeNull();
    expect(screen.getByText(/MD5 and SHA-1 are legacy/)).toBeVisible();
    input("Text to hash", "  test\n");
    choose("Hash algorithm", "MD5");
    run();
    await waitFor(() =>
      expect(mock.state.run).toHaveBeenCalledWith({
        tool: "hash",
        target: "  test\n",
        timeoutMs: 5000,
        route: "direct",
        options: { algorithm: "MD5" },
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs IPv6 CIDR locally and rejects oversized IPv4 sweeps", async () => {
    setup();
    tool("IP calculator");
    input("IP address / prefix (CIDR)", "2001:db8::/64");
    run();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled(),
    );
    expect(mock.state.run.mock.lastCall?.[0]).toMatchObject({
      tool: "ipCalculator",
      target: "2001:db8::/64",
      route: "direct",
    });
    mock.state.run.mockClear();
    tool("Ping sweep");
    input("IPv4 subnet (CIDR)", "192.0.2.0/23");
    choose("Routing for this tool", "Direct / local network");
    run();
    expect(screen.getByRole("alert")).toHaveTextContent("256 IPv4 addresses");
    expect(mock.state.run).not.toHaveBeenCalled();
  });

  it("allows DNS underscore labels but requires an explicit resolver", async () => {
    setup();
    tool("DNS lookup");
    input("DNS name", "_sip._tcp.example.org");
    choose("Routing for this tool", "Direct / local network");
    choose("Record type", "SRV");
    run();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter resolver");
    expect(mock.state.run).not.toHaveBeenCalled();
    input("Resolver IP[:port]", "192.0.2.53");
    run();
    await waitFor(() => expect(mock.state.run).toHaveBeenCalledOnce());
    expect(mock.state.run.mock.lastCall?.[0]).toMatchObject({
      target: "_sip._tcp.example.org",
      options: { resolver: "192.0.2.53", recordType: "SRV", transport: "udp" },
    });
  });

  it.each([
    ["iPerf", "Target hostname or IP address"],
    ["DHCP INFORM", "DHCP server IPv4 address"],
  ])("requires fresh traffic confirmation for %s", async (name, label) => {
    setup();
    tool(name);
    input(label, "192.0.2.1");
    if (name === "DHCP INFORM")
      input("Existing local IPv4 address", "192.0.2.2");
    choose("Routing for this tool", "Direct / local network");
    run();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Confirm that you authorize",
    );
    expect(mock.state.run).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I authorize this tool to generate network traffic.",
      }),
    );
    run();
    await waitFor(() => expect(mock.state.run).toHaveBeenCalledOnce());
    expect(mock.state.run.mock.lastCall?.[0].options.confirmTraffic).toBe(
      "true",
    );
    expect(
      screen.getByRole("checkbox", {
        name: "I authorize this tool to generate network traffic.",
      }),
    ).not.toBeChecked();
  });

  it("requires a TCP port and forwards only the supported source binding", async () => {
    setup();
    tool("Port check");
    input("Target hostname or IP address", "192.0.2.1");
    choose("Routing for this tool", "Direct / local network");
    run();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter tcp port");
    expect(mock.state.run).not.toHaveBeenCalled();
    input("TCP port", "443");
    input("Local source IP (optional)", "192.0.2.2");
    run();
    await waitFor(() => expect(mock.state.run).toHaveBeenCalledOnce());
    expect(mock.state.run.mock.lastCall?.[0].options).toEqual({
      port: "443",
      localAddress: "192.0.2.2",
    });
  });

  it("exposes bounded GET/HEAD options and the actual provider defaults", async () => {
    setup();
    tool("HTTP request");
    input("HTTP(S) URL", "https://example.org/");
    choose("Routing for this tool", "Direct / local network");
    choose("HTTP method", "HEAD");
    input("Maximum redirects", "2");
    input("Maximum response bytes", "4096");
    run();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled(),
    );
    expect(mock.state.run.mock.lastCall?.[0].options).toEqual({
      method: "HEAD",
      maxRedirects: "2",
      maxBytes: "4096",
    });
    tool("RDAP");
    expect(screen.getByLabelText("RDAP provider base URL")).toHaveValue(
      "https://rdap.org",
    );
    expect(screen.getByText(/third-party provider rdap.org/)).toBeVisible();
    tool("Public IP");
    expect(screen.getByLabelText("Public IP provider URL")).toHaveValue(
      "https://api.ipify.org?format=json",
    );
    expect(screen.getByText(/not a DNS or proxy leak audit/)).toBeVisible();
    expect(mock.state.run).toHaveBeenCalledOnce();
  });

  it("describes the HTTPS-only TLS probe and sends the selected proxy without a port override", async () => {
    setup();
    tool("TLS certificate");
    expect(screen.getByText(/leaf certificate using HTTPS HEAD/)).toBeVisible();
    input("TLS hostname, IP or HTTPS URL", "https://example.org:8443/");
    choose("Routing for this tool", "HTTP proxy");
    input("HTTP proxy URL", "http://proxy.example:8080");
    run();
    await waitFor(() => expect(mock.state.run).toHaveBeenCalledOnce());
    expect(mock.state.run.mock.lastCall?.[0]).toEqual({
      tool: "tls",
      target: "https://example.org:8443/",
      timeoutMs: 5000,
      route: "httpProxy",
      proxyUrl: "http://proxy.example:8080",
      options: {},
    });
  });

  it("cancels an in-flight run and ignores a late rejection without blocking a new run", async () => {
    let reject!: (error: Error) => void;
    mock.state.run.mockImplementationOnce(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    setup();
    input("Target hostname or IP address", "example.org");
    choose("Routing for this tool", "Direct / local network");
    run();
    run();
    expect(mock.state.run).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Ping" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mock.state.cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
    await act(async () => {
      reject(new Error("Late stale failure"));
    });
    expect(screen.queryByText("Late stale failure")).toBeNull();
    run();
    await waitFor(() => expect(mock.state.run).toHaveBeenCalledTimes(2));
  });

  it("shows native-unavailable and rejected-run errors without fake reports or browser networking", async () => {
    mock.state.error =
      "Network Toolkit requires the desktop app. No network request was made.";
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "requires the desktop app",
    );
    expect(screen.queryByRole("table")).toBeNull();
    mock.state.run.mockRejectedValue(new Error("Native diagnostic failed"));
    input("Target hostname or IP address", "example.org");
    choose("Routing for this tool", "Direct / local network");
    run();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Native diagnostic failed",
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders structured data and HTML-shaped responses only as escaped text", () => {
    mock.state.report = report("safe", [
      { response: '<img src="https://evil.invalid" onerror="alert(1)">' },
    ]);
    const { container } = setup();
    expect(
      screen.getByRole("table", { name: "Diagnostic result data" }),
    ).toBeVisible();
    expect(container.querySelector("img,iframe,script")).toBeNull();
    choose("Result format", "JSON");
    expect(screen.getByLabelText("JSON report")).toHaveTextContent("onerror");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("copies JSON/text and reports clipboard failure truthfully", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mock.state.report = report();
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify(mock.state.report, null, 2),
      ),
    );
    choose("Result format", "Text");
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await waitFor(() =>
      expect(writeText.mock.lastCall?.[0]).toContain("Route: direct"),
    );
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await waitFor(() => expect(screen.getByText(/Copy failed/)).toBeVisible());
  });

  it("downloads JSON/text blobs and revokes their object URLs", async () => {
    const NativeURL = URL;
    const create = vi.fn((_blob: Blob | MediaSource) => "blob:toolkit-test");
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends NativeURL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    mock.state.report = report();
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((create.mock.calls[0][0] as Blob).type).toContain(
      "application/json",
    );
    choose("Result format", "Text");
    fireEvent.click(screen.getByRole("button", { name: "Download text" }));
    expect(clicks).toEqual([
      "network-toolkit-report.json",
      "network-toolkit-report.txt",
    ]);
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("keeps only bounded opt-in history, never reruns a selected report, and clears it", async () => {
    const view = setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Keep up to 8 reports/ }),
    );
    for (let index = 0; index < 10; index++) {
      mock.state.report = report(`job-${index}`);
      view.rerender(<NetworkToolkit isOpen embedded onClose={view.onClose} />);
    }
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("Session report history")).getAllByRole(
          "button",
        ),
      ).toHaveLength(9),
    );
    fireEvent.click(screen.getByRole("button", { name: "2. ping" }));
    expect(screen.getByText(/Viewing a session report/)).toBeVisible();
    expect(mock.state.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear results" }));
    expect(mock.state.clear).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Session report history")).toBeNull();
  });

  it("bounds table and JSON previews without silently truncating exported reports", async () => {
    const rows = Array.from({ length: 110 }, (_, index) => ({
      [`field-${index}`]: "value",
    }));
    mock.state.report = report("bounded", rows);
    const view = setup();
    expect(
      screen.getByText(/Table preview is bounded to 100 rows and 16 columns/),
    ).toBeVisible();
    expect(screen.getAllByRole("columnheader")).toHaveLength(16);
    const large = "data".repeat(40000);
    mock.state.report = report("large", { large });
    view.rerender(<NetworkToolkit isOpen embedded onClose={view.onClose} />);
    choose("Result format", "JSON");
    expect(screen.getByText(/Preview truncated/)).toBeVisible();
    expect(screen.getByLabelText("JSON report").textContent!.length).toBe(
      128 * 1024,
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify(mock.state.report, null, 2),
      ),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Keep up to 8 reports/ }),
    );
    expect(screen.queryByLabelText("Session report history")).toBeNull();
  });

  it("cancels and unsubscribes on close/unmount and forgets routing on a fresh session", () => {
    const view = setup();
    choose("Routing for this tool", "Direct / local network");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(view.onClose).toHaveBeenCalledOnce();
    view.rerender(
      <NetworkToolkit isOpen={false} embedded onClose={view.onClose} />,
    );
    expect(mock.state.cancel).toHaveBeenCalledOnce();
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
    view.rerender(<NetworkToolkit isOpen embedded onClose={view.onClose} />);
    expect(
      screen.getByRole("combobox", { name: "Routing for this tool" }),
    ).toHaveTextContent("Choose a route");
  });
});
