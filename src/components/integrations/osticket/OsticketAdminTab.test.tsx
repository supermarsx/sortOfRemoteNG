import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, dflt?: string) => dflt ?? _key,
  }),
}));

import OsticketAdminTab from "./OsticketAdminTab";
import { osticketAdminApi } from "../../../hooks/integration/osticket/useOsticketAdmin";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.resolve([]));
});

describe("OsticketAdminTab", () => {
  it("renders the group nav and loads departments on mount", async () => {
    render(<OsticketAdminTab connectionId="conn-1" />);

    expect(screen.getByText("Departments")).toBeInTheDocument();
    expect(screen.getByText("Fields & Forms")).toBeInTheDocument();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("osticket_list_departments", {
        id: "conn-1",
      }),
    );
  });

  it("switching groups loads that domain (SLA)", async () => {
    render(<OsticketAdminTab connectionId="conn-1" />);
    fireEvent.click(screen.getByText("SLA Plans"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("osticket_list_sla", {
        id: "conn-1",
      }),
    );
  });

  it("api slice maps the tricky camelCase args + request-bearing commands", () => {
    osticketAdminApi.getDepartment("i", 5);
    osticketAdminApi.setAgentVacation("i", 7, true);
    osticketAdminApi.addTeamMember("i", 3, 9);
    osticketAdminApi.searchCannedResponses("i", "hello");
    osticketAdminApi.listCustomFields("i", 2);
    osticketAdminApi.updateSla("i", 4, { name: "Gold" });

    expect(invokeMock).toHaveBeenCalledWith("osticket_get_department", {
      id: "i",
      deptId: 5,
    });
    expect(invokeMock).toHaveBeenCalledWith("osticket_set_agent_vacation", {
      id: "i",
      agentId: 7,
      onVacation: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("osticket_add_team_member", {
      id: "i",
      teamId: 3,
      staffId: 9,
    });
    expect(invokeMock).toHaveBeenCalledWith("osticket_search_canned_responses", {
      id: "i",
      query: "hello",
    });
    expect(invokeMock).toHaveBeenCalledWith("osticket_list_custom_fields", {
      id: "i",
      formId: 2,
    });
    expect(invokeMock).toHaveBeenCalledWith("osticket_update_sla", {
      id: "i",
      slaId: 4,
      request: { name: "Gold" },
    });
  });

  it("binds all 44 admin commands", () => {
    const cmds = new Set<string>();
    const rec = new Proxy(
      {},
      { get: () => "x" },
    );
    // Enumerate wrapper fns and capture the command name each invokes.
    for (const key of Object.keys(osticketAdminApi)) {
      invokeMock.mockClear();
      (osticketAdminApi as Record<string, (...a: unknown[]) => unknown>)[key](
        "i",
        1,
        2,
        rec,
      );
      const cmd = invokeMock.mock.calls[0]?.[0] as string;
      cmds.add(cmd);
    }
    expect(cmds.size).toBe(44);
    for (const c of cmds) expect(c.startsWith("osticket_")).toBe(true);
  });
});
