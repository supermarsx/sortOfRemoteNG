import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { SynologyPanel } from "../../src/components/synology/SynologyPanel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));
const files = {
  files: [
    {
      name: "notes.txt",
      path: "/public/notes.txt",
      isdir: false,
      additional: { size: 0 },
    },
    { name: "docs", path: "/public/docs", isdir: true },
  ],
  total: 205,
  offset: 0,
};
const native = async (command: string, args?: Record<string, unknown>) => {
  if (command === "syn_fs_connect")
    return {
      status: "connected",
      sessionId: "receipt-a",
      message: "Connected",
    };
  if (command === "syn_fs_disconnect") return true;
  if (command === "syn_fs_list")
    return args?.folderPath === null
      ? {
          files: [{ name: "public", path: "/public", isdir: true }],
          total: 1,
          offset: 0,
        }
      : files;
  if (command === "syn_get_dashboard")
    return {
      systemInfo: { model: "DS920+", version: "7.2" },
      utilization: null,
      storage: null,
      network: null,
      hardware: null,
    };
  if (command === "syn_get_storage_overview")
    return { volumes: [], disks: [], pools: [] };
  if (
    ["syn_list_services", "syn_list_disks", "syn_list_volumes"].includes(
      command,
    )
  )
    return [];
  return null;
};
const fill = () => {
  fireEvent.change(screen.getByLabelText("Host"), {
    target: { value: "nas.example.test" },
  });
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "alice" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "private-password" },
  });
};
const connect = async () => {
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByTestId("synology-file-station");
};
const openFolder = async () => {
  await connect();
  fireEvent.click(await screen.findByRole("button", { name: "public" }));
  await screen.findByText("notes.txt");
};
beforeEach(() =>
  vi
    .mocked(invoke)
    .mockReset()
    .mockImplementation((command, args) =>
      native(command, args as Record<string, unknown>),
    ),
);
afterEach(cleanup);
describe("SynologyPanel mounted native File Station workflow", () => {
  it("returns null when closed", () => {
    const { container } = render(
      <SynologyPanel isOpen={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });
  it("shows accessible credentials with verified HTTPS, no PAT/self-signed/initial OTP fields", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    expect(
      screen.getByRole("dialog", { name: "Synology NAS API" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Synology NAS API" }),
    ).toBeInTheDocument();
    for (const label of ["Host", "Port", "Username", "Password"])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("HTTPS")).toBeChecked();
    expect(screen.queryByText("Allow self-signed")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("token...")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("One-time code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toHaveClass(
      "sor-btn",
      "sor-btn-primary",
    );
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });
  it("explicit HTTP warns about plaintext without silently changing port", () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("HTTPS"));
    expect(screen.getByText(/HTTP sends your password/)).toBeInTheDocument();
    expect(screen.getByLabelText("Port")).toHaveValue(5001);
  });
  it("scoped login opens shared folders without requiring dashboard administration", async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await connect();
    expect(
      screen.getByRole("heading", { name: "File Station" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "public" }),
    ).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("syn_fs_connect", {
      instanceId: expect.any(String),
      requestId: expect.any(String),
      host: "nas.example.test",
      port: 5001,
      username: "alice",
      password: "private-password",
      useHttps: true,
      otpCode: null,
    });
    expect(invoke).toHaveBeenCalledWith(
      "syn_fs_list",
      expect.objectContaining({
        instanceId: expect.any(String),
        expectedSessionId: "receipt-a",
        folderPath: null,
      }),
    );
    expect(invoke).not.toHaveBeenCalledWith("syn_get_dashboard");
  });
  it("shows actionable login failure without insecure fallback", async () => {
    vi.mocked(invoke).mockImplementation((command, args) =>
      command === "syn_fs_connect"
        ? Promise.reject(new Error("NAS certificate validation failed"))
        : native(command, args as Record<string, unknown>),
    );
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "certificate validation failed",
    );
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "syn_connect"),
    ).toHaveLength(0);
  });
  it("opens actual OTP dialog, clears an invalid code, and retries before showing files", async () => {
    let attempts = 0;
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === "syn_fs_connect"
        ? ++attempts === 1
          ? { status: "otp_required", message: "Enter a code" }
          : attempts === 2
            ? { status: "otp_invalid", message: "Invalid code. Try again." }
            : {
                status: "connected",
                sessionId: "receipt-a",
                message: "Connected",
              }
        : native(command, args as Record<string, unknown>),
    );
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    const popup = await screen.findByRole("dialog", {
      name: "Synology two-factor authentication",
    });
    const verify = within(popup).getByRole("button", { name: "Verify code" });
    expect(verify).toHaveClass("sor-btn", "sor-btn-primary");
    expect(
      screen.queryByTestId("synology-file-station"),
    ).not.toBeInTheDocument();
    fireEvent.change(within(popup).getByLabelText("One-time code"), {
      target: { value: "123456" },
    });
    fireEvent.click(verify);
    await screen.findByText(
      "The one-time code was not accepted. Enter a fresh code.",
    );
    expect(within(popup).getByLabelText("One-time code")).toHaveValue("");
    fireEvent.change(within(popup).getByLabelText("One-time code"), {
      target: { value: "234567" },
    });
    fireEvent.click(verify);
    await screen.findByTestId("synology-file-station");
    expect(
      screen.queryByRole("dialog", {
        name: "Synology two-factor authentication",
      }),
    ).not.toBeInTheDocument();
  });
  it("OTP cancel returns to an empty password without enrollment/recovery/device-bypass UI", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: "otp_required",
      message: "Enter a code",
    });
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel sign-in" }),
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByLabelText("One-time code")).not.toBeInTheDocument();
  });
  it("browses folders, sorts and pages without mutating shares", async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await connect();
    expect(screen.getByRole("button", { name: "New folder" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "public" }));
    await screen.findByText("notes.txt");
    expect(screen.getByText("0 B")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sort", { exact: true }), {
      target: { value: "mtime" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "syn_fs_list",
        expect.objectContaining({
          folderPath: "/public",
          offset: 100,
          limit: 100,
          sortBy: "mtime",
        }),
      ),
    );
  });
  it("uses compact selection cells and the shared themed NAS navigation states", async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await openFolder();
    const table = screen.getByRole("table", { name: "File Station files" });
    expect(table.querySelector("colgroup col")).toHaveStyle({
      width: "2.75rem",
    });
    const selectPage = within(table).getByLabelText("Select this page");
    expect(selectPage.closest("th")).toHaveStyle({
      width: "2.75rem",
      maxWidth: "2.75rem",
    });
    const item = within(table).getByLabelText("Select notes.txt");
    expect(item.closest("td")).toHaveStyle({
      width: "2.75rem",
      maxWidth: "2.75rem",
    });
    expect(item).toHaveClass("h-4", "w-4");
    fireEvent.click(item);
    expect(item).toBeChecked();
    expect(item.closest("tr")).toHaveAttribute("aria-selected", "true");
    expect(item.closest("tr")).toHaveClass("sor-accent-choice");
    fireEvent.click(selectPage);
    expect(within(table).getByLabelText("Select docs")).toBeChecked();
    fireEvent.click(selectPage);
    expect(item).not.toBeChecked();
    const sections = screen.getByRole("navigation", { name: "NAS sections" });
    const filesTab = within(sections).getByTestId("synology-tab-fileStation");
    expect(filesTab).toHaveClass("sor-accent-choice");
    expect(filesTab).toHaveAttribute("aria-current", "page");
    expect(sections.innerHTML).not.toMatch(/(?:bg|text|border)-teal/);
    const breadcrumbs = screen.getByRole("navigation", {
      name: "File Station folders",
    });
    expect(
      within(breadcrumbs).getByRole("button", { name: "public" }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(sections).getByTestId("synology-tab-dashboard"));
    expect(filesTab).not.toHaveAttribute("aria-current");
    expect(
      within(sections).getByTestId("synology-tab-dashboard"),
    ).toHaveAttribute("aria-current", "page");
    await screen.findByText("DS920+");
  });
  it("creates a folder only after explicit styled dialog confirmation", async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await openFolder();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const popup = screen.getByRole("dialog", { name: "Create folder" });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([cmd]) => cmd === "syn_fs_create_folder"),
    ).toBe(false);
    fireEvent.change(within(popup).getByLabelText("Name"), {
      target: { value: "created" },
    });
    const confirm = within(popup).getByRole("button", {
      name: "Create folder",
    });
    expect(confirm).toHaveClass("sor-btn", "sor-btn-primary");
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("syn_fs_create_folder", {
        instanceId: expect.any(String),
        expectedSessionId: "receipt-a",
        folderPath: "/public",
        name: "created",
      }),
    );
    await screen.findByText("Folder created.");
  });
  it("multi-select delete presents captured names and never treats start as completed", async () => {
    let finish!: (value: unknown) => void;
    const status = new Promise((resolve) => {
      finish = resolve;
    });
    vi.mocked(invoke).mockImplementation((command, args) =>
      command === "syn_fs_start_task"
        ? Promise.resolve({ taskId: "delete-a" })
        : command === "syn_fs_task_status"
          ? status
          : native(command, args as Record<string, unknown>),
    );
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await openFolder();
    fireEvent.click(screen.getByLabelText("Select this page"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const popup = screen.getByRole("dialog", { name: "Delete selected items" });
    expect(within(popup).getByText("notes.txt")).toBeInTheDocument();
    expect(within(popup).getByText("docs")).toBeInTheDocument();
    fireEvent.click(
      within(popup).getByRole("button", { name: "Delete selected items" }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "syn_fs_start_task",
        expect.objectContaining({
          paths: ["/public/notes.txt", "/public/docs"],
        }),
      ),
    );
    expect(
      screen.queryByText("Delete completed on the NAS."),
    ).not.toBeInTheDocument();
    await act(async () =>
      finish({
        taskId: "delete-a",
        operation: "delete",
        finished: true,
        progress: 1,
      }),
    );
    await screen.findByText("Delete completed on the NAS.");
  });
  it("keeps Dashboard, Services, System and Storage admin views available on same scoped client", async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await connect();
    fireEvent.click(screen.getByTestId("synology-tab-dashboard"));
    await screen.findByText("DS920+");
    fireEvent.click(screen.getByTestId("synology-tab-services"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "syn_list_services",
        expect.objectContaining({
          instanceId: expect.any(String),
          expectedSessionId: "receipt-a",
        }),
      ),
    );
    fireEvent.click(screen.getByTestId("synology-tab-system"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "syn_get_system_info",
        expect.objectContaining({
          instanceId: expect.any(String),
          expectedSessionId: "receipt-a",
        }),
      ),
    );
    fireEvent.click(screen.getByTestId("synology-tab-storage"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "syn_get_storage_overview",
        expect.objectContaining({
          instanceId: expect.any(String),
          expectedSessionId: "receipt-a",
        }),
      ),
    );
  });
  it("renders bounded task progress without declaring unfinished work complete", async () => {
    let polls = 0;
    vi.mocked(invoke).mockImplementation((command, args) =>
      command === "syn_fs_start_task"
        ? Promise.resolve({ taskId: "copy-a" })
        : command === "syn_fs_task_status"
          ? Promise.resolve({
              taskId: "copy-a",
              operation: "copy",
              finished: ++polls > 1,
              progress: 1,
            })
          : native(command, args as Record<string, unknown>),
    );
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await openFolder();
    fireEvent.click(screen.getByLabelText("Select notes.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    const popup = screen.getByRole("dialog", { name: "Copy selected items" });
    fireEvent.change(within(popup).getByLabelText("Destination folder"), {
      target: { value: "/public/target" },
    });
    fireEvent.click(
      within(popup).getByRole("button", { name: "Copy selected items" }),
    );
    expect(
      await within(popup).findByRole("progressbar", {
        name: "NAS file task progress",
      }),
    ).toHaveAttribute("value", "99");
    expect(
      screen.queryByText("Copy completed on the NAS."),
    ).not.toBeInTheDocument();
    await waitFor(
      () =>
        expect(
          screen.getByText("Copy completed on the NAS."),
        ).toBeInTheDocument(),
      { timeout: 2000 },
    );
  });
  it("disconnect releases only this receipt", async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    await connect();
    fireEvent.click(screen.getByTitle("Disconnect"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
        instanceId: expect.any(String),
        expectedSessionId: "receipt-a",
      }),
    );
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });
});
