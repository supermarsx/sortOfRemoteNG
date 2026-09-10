import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  mgr: {
    loading: false,
    busy: false,
    error: null as string | null,
    notice: null as string | null,
    available: true,
    databaseId: "db-a" as string | null,
    scopeKey: "db-a:1",
    rows: [] as Array<{
      id: string;
      connectionId: string;
      connectionName: string;
      sourceOrigin: string;
      origin: string;
    }>,
    connections: [] as Array<{
      id: string;
      name: string;
      sourceOrigin: string;
    }>,
    refresh: vi.fn(),
    add: vi.fn(),
    forget: vi.fn(),
  },
}));
vi.mock("../../src/hooks/security/useTrustedRedirectDestinations", () => ({
  useTrustedRedirectDestinations: () => fixture.mgr,
}));
import TrustedRedirectDestinationsPanel from "../../src/components/security/TrustedRedirectDestinationsPanel";
beforeEach(() => {
  Object.assign(fixture.mgr, {
    loading: false,
    busy: false,
    error: null,
    notice: null,
    available: true,
    databaseId: "db-a",
    scopeKey: "db-a:1",
  });
  fixture.mgr.connections = [
    { id: "nas", name: "Office NAS", sourceOrigin: "https://office.example" },
    { id: "wiki", name: "Team wiki", sourceOrigin: "https://wiki.example" },
  ];
  fixture.mgr.rows = fixture.mgr.connections.map((connection) => ({
    id: connection.id,
    connectionId: connection.id,
    connectionName: connection.name,
    sourceOrigin: connection.sourceOrigin,
    origin: `https://relay-${connection.id}.example`,
  }));
  fixture.mgr.refresh.mockReset().mockResolvedValue(undefined);
  fixture.mgr.add.mockReset().mockResolvedValue(undefined);
  fixture.mgr.forget.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};
describe("Trust Center redirect destinations", () => {
  it("searches metadata and filters using a themed searchable connection picker", () => {
    render(<TrustedRedirectDestinationsPanel />);
    expect(screen.getByRole("table")).toHaveTextContent("Office NAS");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "relay-wiki" },
    });
    expect(screen.getByRole("table")).not.toHaveTextContent("Office NAS");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    choose("Filter redirect connection", "Office NAS — https://office.example");
    expect(screen.getByRole("table")).not.toHaveTextContent("Team wiki");
    expect(screen.getByRole("table")).toHaveTextContent(
      "https://office.example",
    );
  });
  it("adds only after explicit exact-origin review and never exposes malformed input in errors", async () => {
    render(<TrustedRedirectDestinationsPanel />);
    choose(
      "Saved connection for destination",
      "Office NAS — https://office.example",
    );
    fireEvent.change(screen.getByLabelText("Destination origin"), {
      target: { value: "https://user:SECRET@nas.example/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review add" }));
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
    expect(fixture.mgr.add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Destination origin"), {
      target: { value: "HTTPS://NEW.EXAMPLE:443/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review add" }));
    const dialog = screen.getByTestId("redirect-destination-review");
    expect(dialog).toHaveTextContent("https://new.example");
    expect(dialog).toHaveTextContent("https://office.example");
    fireEvent.keyDown(document, { key: "Enter" });
    expect(fixture.mgr.add).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Trust destination" }),
    );
    await waitFor(() =>
      expect(fixture.mgr.add).toHaveBeenCalledWith(
        "nas",
        "https://new.example",
      ),
    );
  });
  it("reviews row and bulk forget with cancel preserving preferences", async () => {
    render(<TrustedRedirectDestinationsPanel />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Forget Office NAS: https://relay-nas.example",
      }),
    );
    fireEvent.click(
      within(screen.getByTestId("redirect-destination-review")).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    expect(fixture.mgr.forget).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select destinations on this page",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget selected" }));
    fireEvent.click(
      within(screen.getByTestId("redirect-destination-review")).getByRole(
        "button",
        { name: "Forget destinations" },
      ),
    );
    await waitFor(() =>
      expect(fixture.mgr.forget).toHaveBeenCalledWith(fixture.mgr.rows),
    );
  });
  it("clears review, selection and input synchronously on owner generation change", () => {
    const view = render(<TrustedRedirectDestinationsPanel />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select destinations on this page",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget selected" }));
    fixture.mgr.scopeKey = "db-b:2";
    fixture.mgr.databaseId = "db-b";
    fixture.mgr.rows = [];
    fixture.mgr.connections = [];
    view.rerender(<TrustedRedirectDestinationsPanel />);
    expect(screen.queryByTestId("redirect-destination-review")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Forget selected" }),
    ).toBeDisabled();
    expect(fixture.mgr.forget).not.toHaveBeenCalled();
  });
  it("masks unavailable rows and blocks changes during loading, lock and writes", () => {
    fixture.mgr.available = false;
    const view = render(<TrustedRedirectDestinationsPanel />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByLabelText("Destination origin")).toBeDisabled();
    expect(screen.getByText(/Open and unlock/)).toBeVisible();
    fixture.mgr.available = true;
    fixture.mgr.loading = true;
    view.rerender(<TrustedRedirectDestinationsPanel />);
    expect(
      screen.getByText("Loading saved redirect destinations…"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Review add" })).toBeDisabled();
  });
  it("rejects a stale reviewed row and preserves a safe error when a save fails", async () => {
    const view = render(<TrustedRedirectDestinationsPanel />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Forget Office NAS: https://relay-nas.example",
      }),
    );
    fixture.mgr.rows = [
      { ...fixture.mgr.rows[0], sourceOrigin: "https://changed.example" },
    ];
    view.rerender(<TrustedRedirectDestinationsPanel />);
    fireEvent.click(
      within(screen.getByTestId("redirect-destination-review")).getByRole(
        "button",
        { name: "Forget destinations" },
      ),
    );
    await screen.findByRole("alert");
    expect(fixture.mgr.forget).not.toHaveBeenCalled();
    fixture.mgr.forget.mockRejectedValue(new Error("SECRET"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Forget Office NAS: https://relay-nas.example",
      }),
    );
    fireEvent.click(
      within(screen.getByTestId("redirect-destination-review")).getByRole(
        "button",
        { name: "Forget destinations" },
      ),
    );
    await waitFor(() => expect(fixture.mgr.forget).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
  });
  it("paginates large destination lists", () => {
    fixture.mgr.rows = Array.from({ length: 51 }, (_, i) => ({
      ...fixture.mgr.rows[0],
      id: `row-${i}`,
      origin: `https://relay-${i}.example`,
    }));
    render(<TrustedRedirectDestinationsPanel />);
    expect(screen.getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
  });
});
