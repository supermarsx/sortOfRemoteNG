import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import PrometheusPanel, { prometheusDescriptor } from "./PrometheusPanel";
import { prometheusApi } from "../../hooks/integration/usePrometheus";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "prometheus_connect":
        return Promise.resolve({ host: "prometheus.lab.local", version: "2.51.0" });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("PrometheusPanel", () => {
  it("renders the connect form when disconnected", async () => {
    render(<PrometheusPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("prometheus.lab.local"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Connect/i })).toBeInTheDocument();
  });

  it("connect maps to prometheus_connect with a wire-shape config (snake_case)", async () => {
    render(<PrometheusPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("prometheus.lab.local"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("prometheus.lab.local"), {
      target: { value: "prometheus.lab.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "prometheus_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "prometheus.lab.local",
            port: 9090,
            use_tls: false,
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed app-service descriptor", () => {
    expect(prometheusDescriptor.key).toBe("prometheus");
    expect(prometheusDescriptor.category).toBe("monitoring");
    expect(typeof prometheusDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct registered command names", () => {
    prometheusApi.instantQuery("c1", "up");
    prometheusApi.listTargets("c1", "active");
    prometheusApi.createSilence("c1", [], "s", "e", "me", "note");
    expect(invokeMock).toHaveBeenCalledWith("prometheus_instant_query", {
      id: "c1",
      query: "up",
      time: undefined,
      timeout: undefined,
    });
    expect(invokeMock).toHaveBeenCalledWith("prometheus_list_targets", {
      id: "c1",
      stateFilter: "active",
    });
    expect(invokeMock).toHaveBeenCalledWith("prometheus_create_silence", {
      id: "c1",
      matchers: [],
      startsAt: "s",
      endsAt: "e",
      createdBy: "me",
      comment: "note",
    });
  });
});
