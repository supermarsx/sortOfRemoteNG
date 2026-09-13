import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CurrentDatabaseSecuritySection from "../../src/components/SettingsDialog/sections/security/CurrentDatabaseSecuritySection";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { CurrentDatabaseChange } from "../../src/utils/connection/databaseManager";

const fixture = vi.hoisted(() => ({
  current: null as ConnectionDatabase | null,
  listener: null as ((event: CurrentDatabaseChange) => void) | null,
  manager: {} as Record<string, ReturnType<typeof vi.fn>>,
  flush: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => fixture.manager },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ flushPendingSave: fixture.flush }),
}));
const database: ConnectionDatabase = {
  id: "a",
  name: "Work database",
  isEncrypted: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastAccessed: new Date().toISOString(),
};
function changeCurrent(value: ConnectionDatabase | null) {
  fixture.current = value;
  fixture.listener?.({ database: value } as CurrentDatabaseChange);
}
beforeEach(() => {
  fixture.current = { ...database };
  fixture.listener = null;
  fixture.flush.mockReset().mockResolvedValue(undefined);
  fixture.manager = {
    getCurrentDatabase: vi.fn(() => fixture.current),
    getDatabase: vi.fn(async (id: string) =>
      id === database.id ? { ...database } : fixture.current,
    ),
    onCurrentDatabaseChange: vi.fn((listener) => {
      fixture.listener = listener;
      return () => {
        fixture.listener = null;
      };
    }),
    changeDatabasePassword: vi.fn().mockResolvedValue({
      committed: true,
      cleanupPending: false,
      warnings: [],
    }),
    removePasswordFromDatabase: vi.fn().mockResolvedValue({
      committed: true,
      cleanupPending: false,
      warnings: [],
    }),
    isDatabaseUnlocked: vi.fn(() => true),
    lockDatabase: vi.fn(async () => changeCurrent(null)),
    closeCurrentDatabase: vi.fn(async () => changeCurrent(null)),
  };
});
function passwords() {
  fireEvent.change(screen.getByLabelText("Database password"), {
    target: { value: "old-password" },
  });
  fireEvent.change(screen.getByLabelText("New database password"), {
    target: { value: "new-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm database password"), {
    target: { value: "new-password" },
  });
}
describe("Current database security", () => {
  it("themes password and close actions while preserving validation and host guards", () => {
    fixture.current = { ...database, isEncrypted: false };
    render(<CurrentDatabaseSecuritySection />);
    const enable = screen.getByRole("button", {
      name: "Enable database password",
    });
    const close = screen.getByRole("button", {
      name: "Close current database",
    });
    expect(enable).toHaveClass("sor-btn-primary-sm");
    expect(close).toHaveClass("sor-btn-secondary-sm");
    expect(enable).toBeDisabled();
    expect(close).toBeDisabled();
    fireEvent.change(screen.getByLabelText("New database password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm database password"), {
      target: { value: "new-password" },
    });
    expect(enable).toBeEnabled();
    expect(close).toBeDisabled();
  });
  it("uses matching themed variants for protected database actions", () => {
    render(<CurrentDatabaseSecuritySection />);
    expect(
      screen.getByRole("button", { name: "Change database password" }),
    ).toHaveClass("sor-btn-primary-sm");
    expect(
      screen.getByRole("button", { name: "Lock current database" }),
    ).toHaveClass("sor-btn-secondary-sm");
    expect(
      screen.getByRole("button", { name: "Remove database password" }),
    ).toHaveClass("sor-btn-danger-sm");
  });
  it("reopens a closed unencrypted target without requesting a database password", async () => {
    fixture.current = { ...database, isEncrypted: false };
    fixture.manager.getDatabase.mockResolvedValue({
      ...database,
      isEncrypted: false,
    });
    const open = vi.fn(async () =>
      changeCurrent({ ...database, isEncrypted: false }),
    );
    render(
      <CurrentDatabaseSecuritySection
        onBeforeCurrentLock={vi.fn().mockResolvedValue(undefined)}
        onDatabaseClose={vi.fn()}
        onDatabaseSelect={open}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close current database" }),
    );
    await screen.findByRole("button", { name: "Open this database" });
    expect(
      screen.getByRole("button", { name: "Open this database" }),
    ).toHaveClass("sor-btn-primary-sm");
    expect(screen.queryByLabelText("Database password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open this database" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("a", undefined));
  });
  it("keeps committed success and clears secrets when cleanup blocks metadata refresh", async () => {
    fixture.manager.changeDatabasePassword.mockImplementation(async () => {
      fixture.manager.getDatabase.mockRejectedValue(
        new Error("Recovery cleanup pending"),
      );
      return {
        committed: true,
        cleanupPending: true,
        warnings: ["Recovery cleanup pending"],
      };
    });
    render(<CurrentDatabaseSecuritySection />);
    passwords();
    fireEvent.click(
      screen.getByRole("button", { name: "Change database password" }),
    );
    await screen.findByText(/The password change committed/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Database password")).toHaveValue("");
    expect(screen.getByLabelText("New database password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm database password")).toHaveValue("");
    expect(screen.getByText(/Separate password:/)).toHaveTextContent("enabled");
  });
  it("changes only the named database password after a durable flush", async () => {
    render(<CurrentDatabaseSecuritySection />);
    passwords();
    fireEvent.click(
      screen.getByRole("button", { name: "Change database password" }),
    );
    await waitFor(() =>
      expect(fixture.manager.changeDatabasePassword).toHaveBeenCalledWith(
        "a",
        "old-password",
        "new-password",
      ),
    );
    expect(fixture.flush.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.manager.changeDatabasePassword.mock.invocationCallOrder[0],
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("New database password") as HTMLInputElement)
          .value,
      ).toBe(""),
    );
    expect(
      screen.getByText(/Global security settings are unchanged/),
    ).toBeInTheDocument();
  });
  it("does not mutate when current snapshot cannot be saved", async () => {
    fixture.flush.mockRejectedValue(new Error("disk full"));
    render(<CurrentDatabaseSecuritySection />);
    passwords();
    fireEvent.click(
      screen.getByRole("button", { name: "Change database password" }),
    );
    await screen.findByRole("alert");
    expect(fixture.manager.changeDatabasePassword).not.toHaveBeenCalled();
  });
  it("retains the explicitly locked target for unlock/open and clears secrets", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const closed = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn(async () => changeCurrent(database));
    render(
      <CurrentDatabaseSecuritySection
        onBeforeCurrentLock={prepare}
        onDatabaseClose={closed}
        onDatabaseSelect={open}
      />,
    );
    passwords();
    fireEvent.click(
      screen.getByRole("button", { name: "Lock current database" }),
    );
    await waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(
      screen.getByText(/Last active database \(closed\)/),
    ).toHaveTextContent("Work database");
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.manager.lockDatabase.mock.invocationCallOrder[0],
    );
    expect(screen.queryByLabelText("Database password")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock and open this database" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Unlock Work database" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Database password")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Database password"), {
      target: { value: "unlock-password" },
    });
    fireEvent.click(
      screen
        .getByRole("dialog", { name: "Unlock Work database" })
        .querySelector('button[type="submit"]')!,
    );
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("a", "unlock-password"),
    );
  });
  it("keeps the key when sensitive sessions cannot close", async () => {
    render(
      <CurrentDatabaseSecuritySection
        onBeforeCurrentLock={vi
          .fn()
          .mockRejectedValue(new Error("Session still closing"))}
        onDatabaseClose={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Lock current database" }),
    );
    await screen.findByRole("alert");
    expect(fixture.manager.lockDatabase).not.toHaveBeenCalled();
  });
  it("does not paint a late old-target result over the replacement database", async () => {
    let finish!: () => void;
    fixture.manager.changeDatabasePassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ committed: true, cleanupPending: false, warnings: [] });
        }),
    );
    render(<CurrentDatabaseSecuritySection />);
    passwords();
    fireEvent.click(
      screen.getByRole("button", { name: "Change database password" }),
    );
    await waitFor(() =>
      expect(fixture.manager.changeDatabasePassword).toHaveBeenCalledOnce(),
    );
    act(() =>
      changeCurrent({ ...database, id: "b", name: "Personal database" }),
    );
    await act(async () => finish());
    expect(screen.getByText("Personal database")).toBeInTheDocument();
    expect(
      screen.queryByText(/Database password updated/),
    ).not.toBeInTheDocument();
    expect(
      (screen.getByLabelText("New database password") as HTMLInputElement)
        .value,
    ).toBe("");
  });
  it("requires confirmation to remove the password and Cancel never mutates", () => {
    render(<CurrentDatabaseSecuritySection />);
    fireEvent.change(screen.getByLabelText("Database password"), {
      target: { value: "old-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove database password" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fixture.manager.removePasswordFromDatabase).not.toHaveBeenCalled();
  });
});
