import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OriginConnectionHealthControl from "../../src/components/protocol/webBrowser/OriginConnectionHealthControl";
import type { OriginConnectionHealth } from "../../src/utils/protocol/originConnectionHealth";

afterEach(cleanup);
const health = (
  status: OriginConnectionHealth["status"] = "healthy",
): OriginConnectionHealth => ({
  visible: true,
  status,
  label: status === "healthy" ? "Last load succeeded" : status,
  summary:
    "The last page loaded through the observed proxy. Individual SSH hops are not continuously checked.",
  details: [
    ["Route", "SSH tunnel"],
    ["Evidence", "Last completed page load"],
  ],
  hops: [
    {
      key: "ssh",
      label: "SSH connection",
      kind: "SSH tunnel",
      status: "unknown",
      detail: "No current per-hop observation is available.",
    },
    {
      key: "relay",
      label: "Private proxy",
      kind: "App proxy",
      status: "healthy",
      detail: "Observed during the last load.",
    },
  ],
});
function props(value = health()) {
  return {
    health: value,
    eligible: true,
    scope: "attempt-a",
    assertOwner: vi.fn(),
    onOverlayChange: vi.fn(),
  };
}
describe("native browser connection health control", () => {
  it.each([
    "connecting",
    "healthy",
    "degraded",
    "disconnected",
    "unknown",
  ] as const)(
    "shows one compact accessible %s control with only an app tooltip",
    (status) => {
      const p = props(health(status));
      const view = render(<OriginConnectionHealthControl {...p} />);
      const button = view.getByRole("button", {
        name: `Connection health: ${p.health.label}`,
      });
      expect(button).toHaveAttribute(
        "data-tooltip",
        `Connection health: ${p.health.label}`,
      );
      expect(button).not.toHaveAttribute("title");
      expect(view.queryByRole("region")).toBeNull();
      expect(view.queryByText("SSH connection")).toBeNull();
    },
  );
  it("shows the ordered route with unknown hop evidence separately from a successful page load", async () => {
    const p = props();
    const view = render(<OriginConnectionHealthControl {...p} />);
    fireEvent.click(
      view.getByRole("button", {
        name: "Connection health: Last load succeeded",
      }),
    );
    expect(p.assertOwner).toHaveBeenCalled();
    expect(
      await view.findByRole("region", { name: "Connection health details" }),
    ).toBeTruthy();
    expect(view.getByText(p.health.summary)).toBeTruthy();
    expect(view.getAllByRole("listitem").map((row) => row.textContent)).toEqual(
      [
        expect.stringContaining(
          "SSH connectionunknownSSH tunnelNo current per-hop observation",
        ),
        expect.stringContaining(
          "Private proxyhealthyApp proxyObserved during the last load",
        ),
      ],
    );
    expect(view.getByText("Last completed page load")).toBeTruthy();
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(
      view.getByRole("button", { name: "Close connection health" }),
      { key: "Escape" },
    );
    await waitFor(() =>
      expect(
        view.queryByRole("region", { name: "Connection health details" }),
      ).toBeNull(),
    );
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
  });
  it("dismisses stale attempt details and releases the native overlay reservation", async () => {
    const p = props();
    const view = render(<OriginConnectionHealthControl {...p} />);
    fireEvent.click(view.getByRole("button", { name: /Connection health:/ }));
    await view.findByRole("region", { name: "Connection health details" });
    view.rerender(<OriginConnectionHealthControl {...p} scope="attempt-b" />);
    await waitFor(() => expect(view.queryByRole("region")).toBeNull());
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
  });
  it("does not open after ownership was revoked", () => {
    const p = props();
    p.assertOwner.mockImplementation(() => {
      throw new Error("revoked");
    });
    const view = render(<OriginConnectionHealthControl {...p} />);
    fireEvent.click(view.getByRole("button", { name: /Connection health:/ }));
    expect(view.queryByRole("region")).toBeNull();
  });
  it("closes active details when the tab loses its owner and releases native occlusion", async () => {
    const p = props();
    const view = render(<OriginConnectionHealthControl {...p} />);
    fireEvent.click(view.getByRole("button", { name: /Connection health:/ }));
    await view.findByRole("region", { name: "Connection health details" });
    view.rerender(<OriginConnectionHealthControl {...p} eligible={false} />);
    await waitFor(() => expect(view.queryByRole("region")).toBeNull());
    expect(p.onOverlayChange).toHaveBeenLastCalledWith(false);
    expect(
      view.getByRole("button", { name: /Connection health:/ }),
    ).toBeDisabled();
  });
  it("disables inspection without an active owner and hides absent configured routes", () => {
    const p = props();
    const view = render(
      <OriginConnectionHealthControl {...p} eligible={false} />,
    );
    expect(
      view.getByRole("button", { name: /Connection health:/ }),
    ).toBeDisabled();
    view.rerender(
      <OriginConnectionHealthControl
        {...p}
        health={{ ...p.health, visible: false }}
      />,
    );
    expect(view.queryByRole("button")).toBeNull();
  });
  it("presents historical setup success without replacing its conservative health color", async () => {
    const value = health();
    value.hops[0] = {
      ...value.hops[0],
      stateLabel: "Setup succeeded",
      detail:
        "Negotiation succeeded during setup; current reachability is not checked.",
    };
    const view = render(<OriginConnectionHealthControl {...props(value)} />);
    fireEvent.click(view.getByRole("button", { name: /Connection health:/ }));
    await view.findByRole("region", { name: "Connection health details" });
    expect(view.getByText("Setup succeeded")).toBeTruthy();
    expect(view.getByText(value.hops[0].detail)).toBeTruthy();
    expect(value.hops[0].status).toBe("unknown");
  });
});
