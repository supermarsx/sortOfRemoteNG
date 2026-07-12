import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import HaproxyPanel, { haproxyDescriptor } from "./HaproxyPanel";
import { haproxyApi } from "../../hooks/integration/useHaproxy";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "haproxy_connect":
        return Promise.resolve({
          host: "haproxy.lab.local",
          version: "2.8.3",
          pid: 1234,
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("HaproxyPanel", () => {
  it("renders the connect form when disconnected", async () => {
    render(<HaproxyPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("haproxy.lab.local"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^Connect$/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to haproxy_connect with a snake_case wire config", async () => {
    render(<HaproxyPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("haproxy.lab.local"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("haproxy.lab.local"), {
      target: { value: "haproxy.lab.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "haproxy_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "haproxy.lab.local",
            stats_socket: "/var/run/haproxy/admin.sock",
            config_path: "/etc/haproxy/haproxy.cfg",
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed web-category descriptor", () => {
    expect(haproxyDescriptor.key).toBe("haproxy");
    expect(haproxyDescriptor.category).toBe("web");
    expect(typeof haproxyDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to registered command names + camelCase args", () => {
    haproxyApi.getAcl("c1", "acl-3");
    haproxyApi.addMapEntry("c1", "m1", "k", "v");
    haproxyApi.setServerState("c1", "be", "s1", "drain");
    haproxyApi.setStickTableEntry("c1", "t1", "1.2.3.4", "gpc0=1");
    expect(invokeMock).toHaveBeenCalledWith("haproxy_get_acl", {
      id: "c1",
      aclId: "acl-3",
    });
    expect(invokeMock).toHaveBeenCalledWith("haproxy_add_map_entry", {
      id: "c1",
      mapId: "m1",
      key: "k",
      value: "v",
    });
    expect(invokeMock).toHaveBeenCalledWith("haproxy_set_server_state", {
      id: "c1",
      backend: "be",
      server: "s1",
      action: "drain",
    });
    expect(invokeMock).toHaveBeenCalledWith("haproxy_set_stick_table_entry", {
      id: "c1",
      name: "t1",
      key: "1.2.3.4",
      data: "gpc0=1",
    });
  });
});
