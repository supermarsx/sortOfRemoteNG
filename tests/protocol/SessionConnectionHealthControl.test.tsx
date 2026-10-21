import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SessionConnectionHealthControl from "../../src/components/session/SessionConnectionHealthControl";
import { deriveSessionConnectionHealth } from "../../src/utils/protocol/sessionConnectionHealth";
import { SessionRenderActivityContext } from "../../src/contexts/SessionRenderActivityContext";
import type { Connection } from "../../src/types/connection/connection";
afterEach(cleanup);
const health = deriveSessionConnectionHealth({
  protocol: "ssh",
  status: "connected",
  accessible: true,
  backendSessionId: "actor",
  alive: true,
  connection: { security: { sshTunnel: { enabled: true } } } as Connection,
});
describe("SSH and RDP connection health popup", () => {
  it("shows backend evidence and unknown route hops in one themed toolbar control", async () => {
    const view = render(
      <SessionConnectionHealthControl health={health} scope="actor-a" />,
    );
    const button = view.getByRole("button", {
      name: "Connection health: Connected (backend actor)",
    });
    expect(button).toHaveAttribute(
      "data-tooltip",
      "Connection health: Connected (backend actor)",
    );
    expect(button).not.toHaveAttribute("title");
    fireEvent.click(button);
    await view.findByRole("region", { name: "Connection health details" });
    expect(view.getByText(health.summary)).toBeTruthy();
    expect(view.getByText("SSH tunnel")).toBeTruthy();
    expect(view.getByText("unknown")).toBeTruthy();
    expect(
      view.getByText("Not available from this SSH observation"),
    ).toBeTruthy();
    fireEvent.keyDown(
      view.getByRole("button", { name: "Close connection health" }),
      { key: "Escape" },
    );
    await waitFor(() => expect(view.queryByRole("region")).toBeNull());
  });
  it("closes old actor details rather than carrying them to the replacement", async () => {
    const view = render(
      <SessionConnectionHealthControl health={health} scope="actor-a" />,
    );
    fireEvent.click(view.getByRole("button", { name: /Connection health:/ }));
    await view.findByRole("region", { name: "Connection health details" });
    view.rerender(
      <SessionConnectionHealthControl
        health={{
          ...health,
          status: "unknown",
          label: "Connection not confirmed",
        }}
        scope="actor-b"
      />,
    );
    await waitFor(() => expect(view.queryByRole("region")).toBeNull());
    expect(
      view.getByRole("button", {
        name: "Connection health: Connection not confirmed",
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });
  it("dismisses a background viewer's popup", async () => {
    const view = render(
      <SessionRenderActivityContext.Provider value={{ isActive: true }}>
        <SessionConnectionHealthControl health={health} scope="actor" />
      </SessionRenderActivityContext.Provider>,
    );
    fireEvent.click(view.getByRole("button", { name: /Connection health:/ }));
    await view.findByRole("region", { name: "Connection health details" });
    view.rerender(
      <SessionRenderActivityContext.Provider value={{ isActive: false }}>
        <SessionConnectionHealthControl health={health} scope="actor" />
      </SessionRenderActivityContext.Provider>,
    );
    await waitFor(() => expect(view.queryByRole("region")).toBeNull());
  });
  it("shows setup success separately from current health and VPN prerequisites outside the ordered chain", async () => {
    const view = render(
      <SessionConnectionHealthControl
        scope="actor"
        health={{
          ...health,
          hops: [
            {
              key: "proxy",
              label: "Proxy · proxy.actual.test:1080",
              kind: "Runtime component",
              status: "unknown",
              stateLabel: "Setup succeeded",
              detail: "Current reachability is not checked.",
            },
          ],
          prerequisites: [
            {
              key: "vpn",
              label: "WireGuard lease",
              kind: "Owned VPN prerequisite",
              status: "healthy",
              stateLabel: "Connected",
              detail: "Sampled provider status.",
            },
          ],
        }}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: /Connection health:/ }));
    await view.findByRole("region", { name: "Connection health details" });
    expect(view.getByText("Setup succeeded")).toBeTruthy();
    expect(view.getByText("Owned VPN prerequisites")).toBeTruthy();
    expect(view.getByText("Connected")).toBeTruthy();
    expect(view.getByText("Proxy · proxy.actual.test:1080")).toBeTruthy();
  });
});
