import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebNetworkNotice from "../../src/components/protocol/webBrowser/WebNetworkNotice";
vi.mock(
  "../../src/components/protocol/webBrowser/NativeHttpObservations",
  () => ({
    default: ({
      active,
      proxyOrigin,
    }: {
      active: boolean;
      proxyOrigin?: string;
    }) => (
      <div
        data-testid="native-observation-activity"
        data-active={active}
        data-origin={proxyOrigin}
      />
    ),
  }),
);
afterEach(cleanup);
describe("compact website network notice", () => {
  it("keeps routine guidance collapsed and neutral, and collapses old source diagnostics on handoff", async () => {
    const props = {
      reports: [],
      guard: {
        platform: "windows",
        frameNavigation: "enforced" as const,
        allNetworkRequestsMediated: false as const,
      },
      onReload: vi.fn(),
    };
    const view = render(
      <WebNetworkNotice
        {...props}
        proxyOrigin="http://first.localhost:43123"
      />,
    );
    const region = screen.getByRole("region", {
      name: "Website network restrictions",
    });
    expect(region).not.toHaveClass("bg-warning/5");
    expect(
      screen.getByText(/The Windows native HTTP\(S\) guard is not active/),
    ).not.toBeVisible();
    fireEvent.click(screen.getByText("Protection details"));
    expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
      "data-active",
      "false",
    );
    fireEvent.click(screen.getByText("Advanced diagnostics"));
    await waitFor(() =>
      expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    view.rerender(
      <WebNetworkNotice
        {...props}
        proxyOrigin="http://second.localhost:43124"
      />,
    );
    expect(
      screen.getByText(/The Windows native HTTP\(S\) guard is not active/),
    ).not.toBeVisible();
    expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
      "data-active",
      "false",
    );
    view.rerender(
      <WebNetworkNotice
        {...props}
        proxyOrigin="http://first.localhost:43123"
      />,
    );
    expect(
      screen.getByText(/The Windows native HTTP\(S\) guard is not active/),
    ).not.toBeVisible();
  });
  it("only activates native observation snapshots while Windows details are expanded", async () => {
    const view = render(
      <WebNetworkNotice
        reports={[]}
        proxyOrigin="http://p0123456789abcdef0123456789abcdef.localhost:43123"
        guard={{
          platform: "windows",
          frameNavigation: "enforced",
          allNetworkRequestsMediated: false,
        }}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
      "data-origin",
      "http://p0123456789abcdef0123456789abcdef.localhost:43123",
    );
    expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
      "data-active",
      "false",
    );
    fireEvent.click(screen.getByText("Protection details"));
    expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
      "data-active",
      "false",
    );
    fireEvent.click(screen.getByText("Advanced diagnostics"));
    await waitFor(() =>
      expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    fireEvent.click(screen.getByText("Protection details"));
    await waitFor(() =>
      expect(screen.getByTestId("native-observation-activity")).toHaveAttribute(
        "data-active",
        "false",
      ),
    );
    view.rerender(
      <WebNetworkNotice
        reports={[]}
        guard={{
          platform: "linux",
          frameNavigation: "unsupported",
          allNetworkRequestsMediated: false,
        }}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Protection details"));
    expect(screen.queryByTestId("native-observation-activity")).toBeNull();
  });
  it.each(["missing", "mismatch", "current"] as const)(
    "explains %s module diagnostics without inventing a blocked request",
    (status) => {
      render(
        <WebNetworkNotice
          reports={[]}
          guard={null}
          quickConnectRelevant
          routing={{
            status,
            tacticalRmmApi: false,
            tacticalRmmApiExpected: false,
            tacticalRmmApiOrigins: [],
            fetchInterception: true,
            xhrInterception: true,
            pageNetworkInterception: true,
            quickConnectNavigation: false,
            quickConnectDiscovery: false,
            quickConnectDiscovered: false,
            quickConnectDirectNavigation: false,
            quickConnectRegionalNavigation: false,
          }}
          onReload={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("Protection details"));
      expect(
        screen.getByTestId("web-network-routing-status"),
      ).toHaveTextContent(
        status === "missing"
          ? "Restart the desktop application"
          : status === "mismatch"
            ? "differ from the current connection settings"
            : "off or unavailable for this source",
      );
      expect(
        screen.queryByText("Some website requests were blocked"),
      ).toBeNull();
      expect(
        screen.getByTestId("web-network-routing-status"),
      ).toHaveTextContent("advisory receipt does not approve destinations");
    },
  );
  it("reports the Tactical RMM API capability independently of redirect approval", () => {
    render(
      <WebNetworkNotice
        reports={[]}
        guard={null}
        routing={{
          status: "current",
          tacticalRmmApi: true,
          tacticalRmmApiExpected: true,
          tacticalRmmApiOrigins: ["https://api.rmm.example.test"],
          fetchInterception: true,
          xhrInterception: true,
          pageNetworkInterception: true,
          quickConnectNavigation: false,
          quickConnectDiscovery: false,
          quickConnectDiscovered: false,
          quickConnectDirectNavigation: false,
          quickConnectRegionalNavigation: false,
        }}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Protection details"));
    expect(screen.getByTestId("web-network-routing-status")).toHaveTextContent(
      "Tactical RMM API route: Available",
    );
  });
  it("explains a blocked font without claiming unrelated SecurityErrors have the same cause", () => {
    render(
      <WebNetworkNotice
        reports={[
          {
            kind: "font",
            reason: "origin-not-approved",
            origin: "https://cdn.example",
          },
        ]}
        guard={null}
        onReload={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        /Font request blocked; only explicitly routed font assets can load/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A console SecurityError alone does not identify/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Trust|Enable|Approve/ }),
    ).not.toBeInTheDocument();
  });
  it("does not create a placeholder before a status or report exists", () => {
    const view = render(
      <WebNetworkNotice reports={[]} guard={null} onReload={vi.fn()} />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });
  it("shows origins and unsupported contexts without trust/enable actions", () => {
    render(
      <WebNetworkNotice
        guard={null}
        reports={[
          {
            kind: "fetch",
            reason: "origin-not-approved",
            origin: "https://cdn.example",
          },
          {
            kind: "Worker",
            reason: "unsupported-network-context",
            origin: null,
          },
        ]}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("https://cdn.example")).toBeInTheDocument();
    expect(
      screen.getByText(/No route for this request \(fetch\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unsupported Worker request/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Trust|Enable|Approve/ }),
    ).not.toBeInTheDocument();
  });
  it("distinguishes navigation permission from unsupported background discovery methods", () => {
    render(
      <WebNetworkNotice
        guard={null}
        reports={[
          {
            kind: "xhr",
            reason: "quickconnect-control-method",
            origin: "https://global.quickconnect.to",
          },
        ]}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Protection details"));
    expect(
      screen.getByText(
        /Redirect approval is separate from background-request routing/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Only bounded QuickConnect control POSTs for discovery or relay setup/,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Destination not yet approved/)).toBeNull();
  });
  it("shows native protection limits even without blocked reports", () => {
    render(
      <WebNetworkNotice
        reports={[]}
        guard={{
          platform: "linux",
          frameNavigation: "unsupported",
          allNetworkRequestsMediated: false,
        }}
        onReload={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Native frame navigation protection is not available/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A Windows native HTTP\(S\) guard is not available/),
    ).toBeInTheDocument();
  });
  it("offers one explicit reload for an expired document, with no automatic retry", () => {
    const reload = vi.fn();
    render(
      <WebNetworkNotice
        reports={[
          { kind: "document", reason: "document-expired", origin: null },
        ]}
        guard={null}
        onReload={reload}
      />,
    );
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
