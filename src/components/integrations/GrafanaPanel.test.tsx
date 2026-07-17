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

import GrafanaPanel, { grafanaDescriptor } from "./GrafanaPanel";
import { grafanaApi } from "../../hooks/integration/useGrafana";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "grafana_connect":
        return Promise.resolve({
          host: "grafana.lab.local",
          version: "10.4.0",
          org_name: "Main Org.",
          user_count: 3,
          dashboard_count: 12,
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("GrafanaPanel", () => {
  it("renders the connect form when disconnected", async () => {
    render(<GrafanaPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("grafana.lab.local"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeInTheDocument();
  });

  it("connect maps to grafana_connect with a wire-shape config (snake_case + api_key)", async () => {
    render(<GrafanaPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("grafana.lab.local"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("grafana.lab.local"), {
      target: { value: "grafana.lab.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "grafana_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "grafana.lab.local",
            port: 3000,
            use_tls: false,
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed app-service descriptor", () => {
    expect(grafanaDescriptor.key).toBe("grafana");
    expect(grafanaDescriptor.category).toBe("monitoring");
    expect(typeof grafanaDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct registered command names + camelCase args", () => {
    grafanaApi.getDatasource("c1", 7);
    grafanaApi.listAlertRules("c1", "fold", "grp");
    grafanaApi.addTeamMember("c1", 2, 5);
    expect(invokeMock).toHaveBeenCalledWith("grafana_get_datasource", {
      id: "c1",
      dsId: 7,
    });
    expect(invokeMock).toHaveBeenCalledWith("grafana_list_alert_rules", {
      id: "c1",
      folderUid: "fold",
      ruleGroup: "grp",
    });
    expect(invokeMock).toHaveBeenCalledWith("grafana_add_team_member", {
      id: "c1",
      teamId: 2,
      userId: 5,
    });
  });
});
