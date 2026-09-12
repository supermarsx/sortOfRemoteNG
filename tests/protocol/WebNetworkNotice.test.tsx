import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebNetworkNotice from "../../src/components/protocol/webBrowser/WebNetworkNotice";
afterEach(cleanup);
describe("compact website network notice", () => {
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByText("Review 1 network restriction"));
    expect(
      screen.getByText(
        /Redirect approval is separate from background-request routing/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Only the reviewed QuickConnect discovery POST/),
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
      screen.getByText(/Browser-wide network interception is not yet enforced/),
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
