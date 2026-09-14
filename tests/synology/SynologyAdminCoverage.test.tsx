import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));
import { SynologySessionContent } from "../../src/components/synology/SynologyPanel";
import { useSynologyManager } from "../../src/hooks/synology/useSynologyManager";
import { useSynologyAdminActions } from "../../src/hooks/synology/useSynologyAdminActions";
import type { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import {
  SYNOLOGY_ADMIN_ACTIONS,
  adminActionArgs,
} from "../../src/components/synology/synologyPanel/adminActions";
import { SessionRenderActivityContext } from "../../src/contexts/SessionRenderActivityContext";
import { readFileSync } from "node:fs";
import { ADMIN_READS } from "../../src/hooks/synology/synologyAdminData";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
const connection = (receipt = "session-a", instanceId = "instance-a") =>
  ({
    instanceId,
    sessionId: receipt,
    host: "nas.test",
    port: 5001,
    connectionStatus: "connected",
    assertSessionAccess: vi.fn(),
    notifySessionExpired: vi.fn(),
    disconnect: vi.fn(),
  }) as unknown as ReturnType<typeof useSynologyFileConnection>;
const fixtures: Record<string, unknown> = {
  syn_fs_list: {
    files: [{ path: "/public", name: "public", isdir: true }],
    total: 1,
    offset: 0,
  },
  syn_get_system_info: {
    model: "DS923+",
    serial: "serial123",
    version: "7.2",
    versionString: "build729",
    ram: 8192,
    uptime: 456,
    temperature: 38,
  },
  syn_get_utilization: {
    cpu: { systemLoad: 7, userLoad: 9 },
    memory: { totalReal: 8192, availReal: 4096 },
    network: [],
    disk: [],
  },
  syn_get_storage_overview: {
    disks: [],
    volumes: [],
    storagePools: [],
    ssdCaches: [],
    hotSpares: [],
  },
  syn_list_disks: [
    {
      id: "disk1",
      name: "Disk one",
      model: "native-disk",
      sizeTotal: 409600,
      temp: 35,
      status: "normal",
    },
  ],
  syn_list_volumes: [
    {
      id: "volume1",
      displayName: "Main volume",
      status: "normal",
      sizeTotal: 819200,
      sizeUsed: 102400,
      sizeFree: 716800,
    },
  ],
  syn_list_shared_folders: [
    { name: "public", path: "/volume1/public", volPath: "/volume1" },
  ],
  syn_get_network_overview: {
    hostname: "native-host",
    gateway: "192.0.2.1",
    dns: ["192.0.2.2"],
  },
  syn_list_network_interfaces: [{ id: "eth0", name: "LAN", ip: "192.0.2.3" }],
  syn_list_firewall_rules: [],
  syn_list_users: [{ name: "alice", uid: 1026 }],
  syn_list_groups: [{ name: "staff", gid: 100, members: ["alice"] }],
  syn_list_packages: [
    {
      id: "FileStation",
      name: "File Station",
      version: "1",
      status: "running",
    },
  ],
  syn_list_services: [
    { id: "ssh", name: "SSH", enabled: true, running: true, port: 22 },
  ],
  syn_get_smb_config: { enabled: true, workgroup: "WORKGROUP" },
  syn_get_nfs_config: { enabled: false },
  syn_get_ssh_config: { enabled: true, port: 2222 },
  syn_list_docker_containers: [
    { id: "container-a", name: "webapp", image: "nginx", cpuPercent: 2 },
  ],
  syn_list_docker_images: [
    { repository: "nginx", tag: "stable", size: 876543 },
  ],
  syn_list_docker_networks: [{ name: "bridge", driver: "bridge" }],
  syn_list_docker_projects: [{ name: "app-stack", status: "running" }],
  syn_list_vms: [
    {
      guestId: "guest-native-id",
      guestName: "Build VM",
      status: "running",
      vcpuNum: 4,
      vramSize: 2147483648,
    },
  ],
  syn_list_download_tasks: [
    {
      id: "download-native-id",
      title: "Linux image",
      status: "downloading",
      sizeDownloaded: 654321,
      percentDn: 34,
    },
  ],
  syn_get_download_stats: { speedDownload: 12500, speedUpload: 2500 },
  syn_list_cameras: [
    {
      id: 7,
      name: "Front entrance",
      enabled: true,
      status: 1,
      ip: "192.0.2.7",
    },
  ],
  syn_list_backup_tasks: [
    {
      taskId: 42,
      name: "Nightly",
      status: "idle",
      lastBackupTime: "Yesterday",
      progress: 0.5,
    },
  ],
  syn_list_active_backup_devices: [
    { deviceId: "device-1", deviceName: "Laptop" },
  ],
  syn_get_security_overview: {
    autoBlockEnabled: true,
    firewallEnabled: false,
    httpsEnabled: true,
    advisorScore: 88,
  },
  syn_list_blocked_ips: [{ ip: "192.0.2.55", blockedAt: "2026-09-09" }],
  syn_list_certificates: [
    {
      id: "cert1",
      desc: "NAS cert",
      validTill: "2027-01-01",
      subject: { common_name: "nas.test" },
    },
  ],
  syn_get_auto_block_config: {
    enabled: true,
    attempts: 5,
    withinMinutes: 10,
    blockForever: false,
  },
  syn_get_hardware_info: {
    fanSpeeds: [{ id: "fan1", fanSpeed: 1234, status: "normal" }],
    temperatures: [{ id: "temp1", name: "Processor", temperature: 44 }],
  },
  syn_get_ups_info: {
    enabled: true,
    model: "UPS 1000",
    status: "online",
    runtimeMinutes: 30,
  },
  syn_get_power_schedule: {
    entries: [
      {
        action: "poweron",
        weekday: [1, 2],
        hour: 8,
        minute: 30,
        enabled: true,
      },
    ],
  },
  syn_get_system_logs: [
    { id: 1, time: "12:34", msg: "Native log message", level: "info" },
  ],
  syn_get_connection_logs: [
    {
      time: "12:35",
      ip: "192.0.2.4",
      user: "alice",
      type: "SMB",
      isLogin: true,
      success: true,
    },
  ],
  syn_get_notification_config: {
    emailEnabled: true,
    emailAddress: "admin@example.test",
    pushEnabled: false,
  },
};
beforeEach(() =>
  vi
    .mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) =>
      command === "syn_get_section_access"
        ? {
            section: (args as { section: string }).section,
            status: "available",
            reason: "Primary section read succeeded.",
          }
        : (fixtures[command] ?? null),
    ),
);
const openTab = async (tab: string) => {
  const button = screen.getByTestId(`synology-tab-${tab}`);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("Synology native admin coverage", () => {
  it.each([
    [
      "system",
      "Processes",
      "syn_list_processes",
      {},
      [{ pid: 7, name: "service", memory: 12.5 }],
      "12.5",
    ],
    [
      "storage",
      "iSCSI LUNs",
      "syn_list_iscsi_luns",
      {},
      [{ lunId: "lun-native", name: "LUN", usedSize: 77 }],
      "lun-native",
    ],
    [
      "storage",
      "iSCSI targets",
      "syn_list_iscsi_targets",
      {},
      [
        {
          targetId: "target-native",
          name: "Target",
          mappedLuns: ["lun-native"],
        },
      ],
      "target-native",
    ],
    [
      "shares",
      "Share permissions",
      "syn_get_share_permissions",
      { "Shared folder": "public" },
      [{ name: "reader-native", isReadonly: true }],
      "reader-native",
    ],
    [
      "vms",
      "VM snapshots",
      "syn_list_vm_snapshots",
      { "VM ID": "guest-native-id" },
      [{ snapId: "snapshot-a", takenAt: "2026-09-10" }],
      "2026-09-10",
    ],
    [
      "surveillance",
      "Camera recordings",
      "syn_list_recordings",
      { "Camera ID": "7" },
      [{ id: "recording-a", fileSize: 887766, eventType: "motion-native" }],
      "motion-native",
    ],
    [
      "backup",
      "Backup versions",
      "syn_list_backup_versions",
      { "Backup task ID": "42" },
      [{ versionId: 9, createdTime: "2026-09-09" }],
      "2026-09-09",
    ],
    [
      "fileStation",
      "File Station capabilities",
      "syn_get_file_station_info",
      {},
      {
        hostname: "nas.test",
        isManager: true,
        supportSharing: true,
        supportVirtualProtocol: ["cifs", "nfs"],
      },
      "cifs, nfs",
    ],
  ] as const)(
    "renders typed detail fields for %s / %s",
    async (tab, label, command, fields, payload, text) => {
      vi.mocked(invoke).mockImplementation(async (cmd) =>
        cmd === command ? payload : (fixtures[cmd] ?? null),
      );
      render(<SynologySessionContent connection={connection()} />);
      if (tab !== "fileStation") await openTab(tab);
      fireEvent.click(screen.getByRole("button", { name: label }));
      const form = screen.getByRole("dialog", { name: label });
      for (const [field, value] of Object.entries(fields))
        fireEvent.change(within(form).getByLabelText(field), {
          target: { value },
        });
      fireEvent.click(
        within(form).getByRole("button", { name: "Load details" }),
      );
      expect(await screen.findByText(text)).toBeInTheDocument();
    },
  );
  it("embeds without modal/duplicate close and never creates another connection", async () => {
    render(<SynologySessionContent connection={connection()} />);
    await screen.findByRole("button", { name: "public" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith(
      "syn_fs_connect",
      expect.anything(),
    );
  });
  it.each([
    ["system", "DS923+"],
    ["storage", "716800"],
    ["shares", "/volume1/public"],
    ["network", "native-host"],
    ["users", "staff"],
    ["packages", "File Station"],
    ["services", "2222"],
    ["docker", "876543"],
    ["vms", "guest-native-id"],
    ["downloads", "654321"],
    ["surveillance", "Front entrance"],
    ["backup", "Yesterday"],
    ["security", "88"],
    ["hardware", "1234"],
    ["logs", "Native log message"],
    ["notifications", "admin@example.test"],
  ])("renders actual camelCase %s DTO values", async (tab, value) => {
    render(<SynologySessionContent connection={connection()} />);
    await openTab(tab);
    expect(await screen.findByText(value)).toBeInTheDocument();
    const calls = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command !== "syn_fs_list");
    expect(calls.length).toBeGreaterThan(0);
    for (const [, args] of calls)
      expect(args).toEqual(
        expect.objectContaining({
          instanceId: "instance-a",
          expectedSessionId: "session-a",
        }),
      );
  });
  it("prefills exact VM identity, confirms once, and never calls force shutdown automatically", async () => {
    render(<SynologySessionContent connection={connection()} />);
    await openTab("vms");
    const cell = await screen.findByText("Build VM");
    fireEvent.click(
      within(cell.closest("tr")!).getByRole("button", { name: "Force off" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Force off VM" });
    expect(within(dialog).getByLabelText("VM ID")).toHaveValue(
      "guest-native-id",
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "syn_vm_force_shutdown",
      expect.anything(),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm force off vm" }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("syn_vm_force_shutdown", {
        instanceId: "instance-a",
        expectedSessionId: "session-a",
        guestId: "guest-native-id",
      }),
    );
  });
  it("searches and pages more than 25 real rows", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_list_users"
        ? Array.from({ length: 70 }, (_, i) => ({ name: `user-${i}`, uid: i }))
        : (fixtures[command] ?? null),
    );
    render(<SynologySessionContent connection={connection()} />);
    await openTab("users");
    await screen.findByText("user-0");
    expect(screen.queryByText("user-69")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next Users" }));
    expect(screen.getByText("user-25")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search Users"), {
      target: { value: "user-69" },
    });
    expect(screen.getByText("user-69")).toBeInTheDocument();
  });
  it("clears failed sections and preserves safe actionable errors", async () => {
    let fail = false;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "syn_list_vms" && fail)
        throw new Error("Package unavailable: password=private-token");
      return fixtures[command] ?? null;
    });
    render(<SynologySessionContent connection={connection()} />);
    await openTab("vms");
    await screen.findByText("Build VM");
    fail = true;
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Package unavailable",
    );
    expect(screen.queryByText("Build VM")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-token");
    expect(screen.getByRole("alert")).toHaveTextContent("Virtual machines:");
    expect(screen.getByRole("alert")).not.toHaveTextContent("vms:");
  });
  it("definitive expiry revokes only captured receipt; generic 403 does not", async () => {
    const c = connection();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "syn_list_vms")
        throw new Error("SYNOLOGY_SESSION_EXPIRED: Sign in again");
      return fixtures[command] ?? null;
    });
    render(<SynologySessionContent connection={c} />);
    await openTab("vms");
    await waitFor(() =>
      expect(c.notifySessionExpired).toHaveBeenCalledWith(
        "session-a",
        "SYNOLOGY_SESSION_EXPIRED: Sign in again",
      ),
    );
  });
  it("hidden session pauses polling without resetting the selected tab", async () => {
    const c = connection();
    const { rerender } = render(
      <SessionRenderActivityContext.Provider value={{ isActive: true }}>
        <SynologySessionContent connection={c} />
      </SessionRenderActivityContext.Provider>,
    );
    await openTab("vms");
    await screen.findByText("Build VM");
    rerender(
      <SessionRenderActivityContext.Provider value={{ isActive: false }}>
        <SynologySessionContent connection={c} />
      </SessionRenderActivityContext.Provider>,
    );
    vi.useFakeTimers();
    const before = vi.mocked(invoke).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(65000);
    });
    expect(invoke).toHaveBeenCalledTimes(before);
    expect(screen.getByTestId("synology-tab-vms")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("checks live owner access before a retained mutation, not merely mount state", async () => {
    let locked = false;
    const c = connection();
    c.assertSessionAccess = () => {
      if (locked) throw new Error("Owning database locked");
    };
    const { result } = renderHook(() => useSynologyManager(true, c));
    act(() => result.current.actions.open("user-delete", { name: "alice" }));
    const run = result.current.actions.execute;
    locked = true;
    await act(async () => {
      await run({ name: "alice" });
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "syn_delete_user",
      expect.anything(),
    );
    expect(result.current.actions.error).toContain("Owning database locked");
  });
});
describe("typed domain-action invocation", () => {
  it("preserves required empty shared-folder description instead of sending null", () => {
    const action = SYNOLOGY_ADMIN_ACTIONS.find(
      (item) => item.id === "share-create",
    )!;
    expect(
      adminActionArgs(action, { name: "docs", volPath: "/volume1", desc: "" }),
    ).toEqual({ name: "docs", volPath: "/volume1", desc: "" });
  });
  it("accounts for every current native command with UI or explicit safer replacement", () => {
    const commands = Array.from(
      readFileSync(
        "src-tauri/crates/sorng-commands-nas/src/synology_commands/inner.rs",
        "utf8",
      ).matchAll(/pub async fn (syn_\w+)/g),
      (match) => match[1],
    );
    const mounted = new Set([
      ...Object.values(ADMIN_READS).flatMap((group) => Object.values(group)),
      ...SYNOLOGY_ADMIN_ACTIONS.map((action) => action.command),
      "syn_get_smart_info",
      "syn_get_section_access",
      "syn_fs_connect",
      "syn_fs_cancel_connect",
      "syn_fs_disconnect",
      "syn_fs_list",
      "syn_fs_create_folder",
      "syn_fs_rename",
      "syn_fs_start_task",
      "syn_fs_task_status",
      "syn_fs_stop_task",
      "syn_fs_upload",
      "syn_fs_download",
      "syn_fs_create_share_link",
      "syn_fs_list_share_links",
      "syn_fs_delete_share_links",
      "syn_fs_preview_file",
      "syn_fs_close_preview",
      "syn_fs_open_external",
    ]);
    const replaced = [
      "syn_connect",
      "syn_disconnect",
      "syn_is_connected",
      "syn_check_session",
      "syn_get_config",
      "syn_list_files",
      "syn_list_file_shared_folders",
      "syn_search_files",
      "syn_upload_file",
      "syn_download_file",
      "syn_create_folder",
      "syn_delete_files",
      "syn_rename_file",
      "syn_create_share_link",
      "syn_get_camera_snapshot",
    ];
    expect(
      commands.filter(
        (command) => !mounted.has(command) && !replaced.includes(command),
      ),
    ).toEqual([]);
  });
  it.each(SYNOLOGY_ADMIN_ACTIONS.map((a) => [a.id, a] as const))(
    "%s prepares exact bounded payload and only runs after review",
    async (_id, action) => {
      const call = vi.fn().mockResolvedValue(action.mutation ? undefined : []),
        success = vi.fn();
      const { result } = renderHook(() =>
        useSynologyAdminActions({
          scopeKey: "a",
          invoke: call,
          onSuccess: success,
        }),
      );
      expect(call).not.toHaveBeenCalled();
      const values = Object.fromEntries(
        action.fields.map((field) => [
          field.key,
          field.type === "checkbox"
            ? false
            : field.key === "limit"
              ? "25"
              : field.key === "offset"
                ? "0"
                : field.key === "uri"
                  ? "https://example.test/file"
                  : field.type === "email"
                    ? "test@example.test"
                    : "fixture",
        ]),
      );
      act(() => result.current.open(action.id, values));
      await act(async () => {
        expect(await result.current.execute(values)).toBe(true);
      });
      expect(call).toHaveBeenCalledExactlyOnceWith(
        action.command,
        adminActionArgs(action, values),
      );
      expect(success).toHaveBeenCalledTimes(action.mutation ? 1 : 0);
    },
  );
  it("retained cancelled/replaced review cannot execute; new scope clears sensitive form", async () => {
    const call = vi.fn();
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useSynologyAdminActions({
          scopeKey,
          invoke: call,
          onSuccess: () => {},
        }),
      { initialProps: { scopeKey: "a" } },
    );
    act(() => result.current.open("user-delete", { name: "alice" }));
    const cancelled = result.current.execute;
    act(() => result.current.cancel());
    await act(async () =>
      expect(await cancelled({ name: "alice" })).toBe(false),
    );
    act(() => result.current.open("user-create"));
    const stale = result.current.execute;
    rerender({ scopeKey: "b" });
    await act(async () =>
      expect(await stale({ name: "bob", password: "secret" })).toBe(false),
    );
    expect(call).not.toHaveBeenCalled();
    expect(result.current.review).toBeNull();
  });
  it("rejects controls, missing identifiers, unsafe download scheme and out-of-range page size", () => {
    const by = (id: string) => SYNOLOGY_ADMIN_ACTIONS.find((a) => a.id === id)!;
    expect(() => adminActionArgs(by("user-delete"), { name: "" })).toThrow();
    expect(() =>
      adminActionArgs(by("user-delete"), { name: "a\nb" }),
    ).toThrow();
    expect(() =>
      adminActionArgs(by("download-create"), { uri: "file:///etc/passwd" }),
    ).toThrow();
    expect(() =>
      adminActionArgs(by("recordings"), {
        camId: "1",
        offset: "0",
        limit: "101",
      }),
    ).toThrow();
  });
});
