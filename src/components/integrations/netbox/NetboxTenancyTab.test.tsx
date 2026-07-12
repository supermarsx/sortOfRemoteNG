import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, dflt?: string | Record<string, unknown>) =>
      typeof dflt === "string" ? dflt : _key,
  }),
}));

import NetboxTenancyTab from "./NetboxTenancyTab";
import { netboxTenancyApi } from "../../../hooks/integration/netbox/useNetboxTenancy";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ count: 0, results: [] });
});

describe("netboxTenancyApi arg mapping", () => {
  it("maps id-bearing reads/writes to camelCase Tauri args", async () => {
    await netboxTenancyApi.getTenant("c", 7);
    await netboxTenancyApi.getTenantGroup("c", 3);
    await netboxTenancyApi.getContact("c", 9);
    await netboxTenancyApi.partialUpdateContact("c", 9, { title: "Ops" });
    await netboxTenancyApi.deleteTenant("c", 7);
    await netboxTenancyApi.listContactAssignments("c");

    expect(invokeMock).toHaveBeenCalledWith("netbox_get_tenant", {
      id: "c",
      tenantId: 7,
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_get_tenant_group", {
      id: "c",
      groupId: 3,
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_get_contact", {
      id: "c",
      contactId: 9,
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_partial_update_contact", {
      id: "c",
      contactId: 9,
      data: { title: "Ops" },
    });
    expect(invokeMock).toHaveBeenCalledWith("netbox_delete_tenant", {
      id: "c",
      tenantId: 7,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "netbox_list_contact_assignments",
      { id: "c" },
    );
  });

  it("binds all 24 tenancy commands", () => {
    const fns = Object.values(netboxTenancyApi).filter(
      (f) => typeof f === "function",
    );
    expect(fns.length).toBe(24);
  });
});

describe("NetboxTenancyTab", () => {
  it("loads the tenants list on mount", async () => {
    render(<NetboxTenancyTab connectionId="conn-1" summary={null} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("netbox_list_tenants", {
        id: "conn-1",
        params: [],
      }),
    );
    expect(screen.getAllByText("Tenants").length).toBeGreaterThan(0);
  });
});
