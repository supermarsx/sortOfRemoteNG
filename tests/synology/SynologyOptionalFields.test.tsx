import {
  cleanup,
  fireEvent,
  render,
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
import type { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import type {
  ActiveBackupDevice,
  AutoBlockConfig,
  BackupTaskInfo,
  BlockedIp,
  Camera,
  CertificateInfo,
  ConnectionEntry,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerProject,
  FirewallRule,
  LogEntry,
  NetworkInterface,
  NetworkOverview,
  ProcessInfo,
  Recording,
  SecurityOverview,
  ServiceStatus,
  SurveillanceInfo,
  SynoGroup,
  SynoUser,
} from "../../src/types/hardware/synology";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// Every fixture below is typed `Required<Dto>`: all keys are present, and a value DSM does
// not report is `null`, exactly as the native DTO serializes an `Option::None`.
const users: Required<SynoUser>[] = [
  {
    name: "alice",
    uid: null,
    description: "Operator",
    email: null,
    expired: null,
    enableHomeService: null,
  },
];
const groups: Required<SynoGroup>[] = [
  { name: "staff", gid: 100, description: "Staff", members: null },
];
const services: Required<ServiceStatus>[] = [
  {
    id: "ssh",
    name: "SSH service",
    enabled: true,
    running: null,
    port: null,
    serviceType: null,
  },
];
const containers: Required<DockerContainer>[] = [
  {
    id: "container-a",
    name: "webapp",
    image: "nginx:stable",
    status: "running",
    state: "running",
    created: "2026-09-01T00:00:00Z",
    finishedAt: null,
    upTime: null,
    cpuPercent: null,
    memoryUsage: null,
    memoryLimit: null,
    ports: null,
    volumes: null,
  },
];
const images: Required<DockerImage>[] = [
  {
    id: "sha256:0000",
    repository: "nginx",
    tag: "stable",
    created: null,
    size: 876543,
    virtualSize: null,
  },
];
const dockerNetworks: Required<DockerNetwork>[] = [
  {
    name: "bridge-net",
    id: "net-0000",
    driver: "bridge",
    scope: null,
    subnet: "198.51.100.0/24",
    gateway: null,
    containers: 2,
  },
];
const projects: Required<DockerProject>[] = [
  {
    id: "00000000-0000-0000-0000-000000000000",
    name: "app-stack",
    status: "RUNNING",
    services: ["web"],
    path: "/volume1/docker/app-stack",
  },
];
const cameras: Required<Camera>[] = [
  {
    id: 7,
    name: "Front entrance",
    ip: null,
    port: 554,
    model: "SYNTH-CAM",
    vendor: null,
    status: 1,
    enabled: null,
    recording: null,
    resolution: null,
    fps: null,
    streamPath: null,
    snapshotPath: null,
  },
];
const backupTasks: Required<BackupTaskInfo>[] = [
  {
    taskId: 42,
    name: "Nightly",
    status: null,
    lastBackupTime: "1757894400",
    nextBackupTime: null,
    destType: null,
    destPath: null,
    totalSize: null,
    transferredSize: null,
    progress: null,
  },
];
const devices: Required<ActiveBackupDevice>[] = [
  {
    deviceId: 3,
    deviceName: "Laptop",
    deviceType: null,
    status: null,
    lastBackup: "2026-09-14 02:00",
    agentVersion: null,
    ipAddress: "192.0.2.30",
    osName: "Windows 11",
  },
];
const security: Required<SecurityOverview> = {
  autoBlockEnabled: null,
  firewallEnabled: null,
  httpsEnabled: null,
  advisorScore: null,
  blockedIps: null,
  certificateInfo: null,
  scanStatus: "outOfDate",
  scanProgress: 100,
  lastScanTime: 1341210005,
  categories: [
    {
      category: "malware",
      severity: "safe",
      danger: 0,
      risk: 0,
      warning: 0,
      info: 0,
      outOfDate: 0,
    },
  ],
};
const blockedIps: Required<BlockedIp>[] = [
  { ip: "198.51.100.9", blockedAt: null, reason: null },
];
const certificates: Required<CertificateInfo>[] = [
  {
    id: "cert-0",
    desc: "Default",
    subject: { common_name: "nas.invalid" },
    issuer: { common_name: "nas.invalid" },
    validFrom: "2026-01-01",
    validTill: "2027-01-01",
    isDefault: true,
    isBroken: null,
    signatureAlgorithm: null,
  },
];
const autoBlock: Required<AutoBlockConfig> = {
  enabled: true,
  attempts: 10,
  withinMinutes: 5,
  blockForever: false,
  expireMinutes: 2880,
  expireDays: 2,
};
const systemLogs: Required<LogEntry>[] = [
  {
    id: null,
    time: "2026/09/15 08:00:00",
    msg: "Synthetic system event",
    level: "info",
    user: "SYSTEM",
    event: null,
    logType: "system",
  },
];
const connections: Required<ConnectionEntry>[] = [
  {
    time: "1757894400",
    ip: "192.0.2.4",
    user: "alice",
    type: "HTTP/HTTPS",
    isLogin: null,
    success: null,
    description: "DSM Desktop",
    protocol: "HTTPS",
    canBeKicked: true,
  },
];
const networkOverview: Required<NetworkOverview> = {
  hostname: "nas-synth",
  workgroup: null,
  dns: ["192.0.2.2"],
  gateway: "192.0.2.1",
  interfaces: null,
};
const interfaces: Required<NetworkInterface>[] = [
  {
    id: "eth0",
    name: "LAN 1",
    mac: null,
    ip: ["192.0.2.3"],
    ipv6: [],
    subnet: "255.255.255.0",
    mtu: null,
    linkSpeed: "1000",
    status: "connected",
    interfaceType: "lan",
  },
];
const firewallRules: Required<FirewallRule>[] = [
  {
    id: "0",
    adapter: "global",
    srcIp: "198.51.100.0/24",
    srcPort: "all",
    direction: null,
    action: "allow",
    protocol: "all",
    enabled: true,
  },
];
const processes: Required<ProcessInfo>[] = [
  {
    pid: 7,
    name: "synoscgi",
    user: null,
    cpu: 0.5,
    memory: 1234,
    threads: null,
  },
];
const recordings: Required<Recording>[] = [
  {
    id: "46",
    cameraId: 7,
    cameraName: "Front entrance",
    startTime: null,
    stopTime: null,
    fileSize: 887766,
    eventType: null,
  },
];
const surveillanceInfo: Required<SurveillanceInfo> = {
  version: { major: 9, minor: 2, build: "2250" },
  cameraCount: null,
  licenseCount: 2,
};

const fixtures: Record<string, unknown> = {
  syn_fs_list: {
    files: [{ path: "/public", name: "public", isdir: true }],
    total: 1,
    offset: 0,
  },
  syn_get_system_info: { model: "DS923+", version: "7.2", ram: 8192 },
  syn_get_utilization: {
    cpu: { systemLoad: 7, userLoad: 9 },
    memory: { totalReal: 8192, availReal: 4096 },
    network: [],
    disk: [],
  },
  syn_get_network_overview: networkOverview,
  syn_list_network_interfaces: interfaces,
  syn_list_firewall_rules: firewallRules,
  syn_list_users: users,
  syn_list_groups: groups,
  syn_list_services: services,
  syn_get_smb_config: { enabled: true },
  syn_get_nfs_config: { enabled: false },
  syn_get_ssh_config: { enabled: true, port: 22 },
  syn_list_docker_containers: containers,
  syn_list_docker_images: images,
  syn_list_docker_networks: dockerNetworks,
  syn_list_docker_projects: projects,
  syn_list_vms: [
    {
      guestId: "guest-0",
      guestName: "Build VM",
      status: "running",
      vcpuNum: 2,
      vramSize: 4096,
    },
  ],
  syn_list_cameras: cameras,
  syn_list_backup_tasks: backupTasks,
  syn_list_active_backup_devices: devices,
  syn_get_security_overview: security,
  syn_list_blocked_ips: blockedIps,
  syn_list_certificates: certificates,
  syn_get_auto_block_config: autoBlock,
  syn_get_system_logs: systemLogs,
  syn_get_connection_logs: connections,
  syn_list_processes: processes,
  syn_check_update: {
    update: {
      available: true,
      version: "7.2.2-72806",
      version_details: { buildnumber: 72806, major: 7, minor: 2 },
    },
  },
  syn_get_active_connections: connections,
  syn_list_recordings: recordings,
  syn_get_surveillance_info: surveillanceInfo,
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
afterEach(() => cleanup());

const connection = () =>
  ({
    instanceId: "instance-a",
    sessionId: "session-a",
    host: "nas.test",
    port: 5001,
    connectionStatus: "connected",
    assertSessionAccess: vi.fn(),
    notifySessionExpired: vi.fn(),
    disconnect: vi.fn(),
  }) as unknown as ReturnType<typeof useSynologyFileConnection>;
const openTab = async (tab: string) => {
  render(<SynologySessionContent connection={connection()} />);
  const button = screen.getByTestId(`synology-tab-${tab}`);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
/** The table section whose heading is `title (count)`. */
const tableSection = (title: string, root: HTMLElement = document.body) => {
  const heading = within(root)
    .getAllByRole("heading", { level: 3 })
    .find(
      (item) => item.textContent?.replace(/\s*\(\d+\)$/, "").trim() === title,
    );
  if (!heading) throw new Error(`No "${title}" table`);
  return heading.closest("section") as HTMLElement;
};
/** Cell text by column label for the row that contains `rowText` in one of its cells. */
const rowCells = async (
  title: string,
  rowText: string,
  root: HTMLElement = document.body,
) => {
  await within(root).findByText(rowText, { selector: "td" });
  const section = tableSection(title, root);
  const labels = within(section)
    .getAllByRole("columnheader")
    .map((header) => header.textContent ?? "");
  const row = within(section)
    .getByText(rowText, { selector: "td" })
    .closest("tr") as HTMLElement;
  const values = Array.from(
    row.querySelectorAll("td"),
    (cell) => cell.textContent ?? "",
  );
  return Object.fromEntries(labels.map((label, i) => [label, values[i]]));
};
const expectNoFailure = () => {
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("synology-read-failures"),
  ).not.toBeInTheDocument();
};
const runAction = async (
  label: string,
  fields: Record<string, string> = {},
) => {
  fireEvent.click(await screen.findByRole("button", { name: label }));
  const form = screen.getByRole("dialog", { name: label });
  for (const [field, value] of Object.entries(fields))
    fireEvent.change(within(form).getByLabelText(field), {
      target: { value },
    });
  fireEvent.click(within(form).getByRole("button", { name: "Load details" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Load details" }),
    ).not.toBeInTheDocument(),
  );
  return screen.getByRole("dialog", { name: label });
};

describe("NAS data DSM does not report renders as unknown", () => {
  it("users without uid and groups without members", async () => {
    await openTab("users");
    expect(await rowCells("Users", "alice")).toMatchObject({
      Username: "alice",
      UID: "—",
      Description: "Operator",
    });
    expect(await rowCells("Groups", "staff")).toMatchObject({
      GID: "100",
      Members: "—",
    });
    expectNoFailure();
  });

  it("services without running state or type", async () => {
    await openTab("services");
    expect(await rowCells("Services", "SSH service")).toMatchObject({
      Enabled: "Yes",
      Running: "—",
      Port: "—",
      Type: "—",
    });
    expectNoFailure();
  });

  it("containers without ports or volumes and networks without scope", async () => {
    await openTab("docker");
    expect(await rowCells("Containers", "webapp")).toMatchObject({
      Image: "nginx:stable",
      State: "running",
      "CPU %": "—",
      "Memory bytes": "—",
    });
    expect(await rowCells("Container networks", "bridge-net")).toMatchObject({
      Driver: "bridge",
      Subnet: "198.51.100.0/24",
      Gateway: "—",
    });
    expect(await rowCells("Projects", "app-stack")).toMatchObject({
      Services: "web",
    });
    expectNoFailure();
  });

  it("cameras without IP or enabled state", async () => {
    await openTab("surveillance");
    expect(await rowCells("Cameras", "Front entrance")).toMatchObject({
      IP: "—",
      Enabled: "—",
      Model: "SYNTH-CAM",
      Recording: "—",
    });
    expectNoFailure();
  });

  it("backup tasks without status and Active Backup devices without type or status", async () => {
    await openTab("backup");
    expect(await rowCells("Backup tasks", "Nightly")).toMatchObject({
      Status: "—",
      "Last backup": "1757894400",
      "Next backup": "—",
    });
    expect(await rowCells("Active Backup devices", "Laptop")).toEqual({
      ID: "3",
      Name: "Laptop",
      OS: "Windows 11",
      Status: "—",
      "Last backup": "2026-09-14 02:00",
    });
    expectNoFailure();
  });

  it("security status fields, blocked IPs without a time and the auto-block expiry", async () => {
    await openTab("security");
    expect(await rowCells("Security", "outOfDate")).toEqual({
      "Auto block": "—",
      Firewall: "—",
      HTTPS: "—",
      "Advisor score": "—",
      "Security Advisor status": "outOfDate",
      "Scan progress %": "100",
      "Last scan (Unix time)": "1341210005",
    });
    expect(await rowCells("Blocked IPs", "198.51.100.9")).toMatchObject({
      Blocked: "—",
      Reason: "—",
    });
    expect(await rowCells("Auto block", "2880")).toMatchObject({
      Indefinite: "No",
      "Expiry minutes": "2880",
      "Expiry days": "2",
    });
    expectNoFailure();
  });

  it("system logs without an id pass the response check, and connections show protocol and description", async () => {
    await openTab("logs");
    expect(await rowCells("System logs", "Synthetic system event")).toEqual({
      Time: "2026/09/15 08:00:00",
      Level: "info",
      User: "SYSTEM",
      Event: "—",
      Message: "Synthetic system event",
    });
    expect(await rowCells("Connection logs", "192.0.2.4")).toEqual({
      Time: "1757894400",
      User: "alice",
      IP: "192.0.2.4",
      Type: "HTTP/HTTPS",
      Protocol: "HTTPS",
      Description: "DSM Desktop",
      Login: "—",
      Success: "—",
    });
    expectNoFailure();
  });
});

describe("columns read the native DTO keys", () => {
  it("network interfaces show subnet and link speed, and firewall rules show adapter, action and source", async () => {
    await openTab("network");
    expect(await rowCells("Interfaces", "eth0")).toMatchObject({
      ID: "eth0",
      IP: "192.0.2.3",
      Mask: "255.255.255.0",
      MAC: "—",
      Speed: "1000",
    });
    expect(await rowCells("Firewall rules", "global")).toEqual({
      Adapter: "global",
      Action: "allow",
      Protocol: "all",
      Ports: "all",
      Source: "198.51.100.0/24",
      Enabled: "Yes",
    });
    expect(await rowCells("Network", "nas-synth")).toMatchObject({
      Workgroup: "—",
    });
    expectNoFailure();
  });

  it("labels VM memory in MB", async () => {
    await openTab("vms");
    expect(await rowCells("Virtual machines", "Build VM")).toMatchObject({
      "RAM MB": "4096",
    });
  });
});

describe("detail actions with fields DSM does not report", () => {
  it("processes render with an unknown user", async () => {
    await openTab("system");
    const dialog = await runAction("Processes");
    expect(await rowCells("Processes", "synoscgi", dialog)).toMatchObject({
      PID: "7",
      User: "—",
      Memory: "1234",
      Threads: "—",
    });
  });

  it("the DSM update check renders the nested update keys", async () => {
    await openTab("system");
    const dialog = await runAction("Check DSM update");
    expect(await rowCells("Check DSM update", "72806", dialog)).toEqual({
      Available: "Yes",
      Version: "7.2.2-72806",
      Build: "72806",
    });
  });

  it("active connections include protocol and description", async () => {
    await openTab("logs");
    const dialog = await runAction("Active connections");
    expect(await rowCells("Active connections", "192.0.2.4", dialog)).toEqual({
      Account: "alice",
      IP: "192.0.2.4",
      Type: "HTTP/HTTPS",
      Protocol: "HTTPS",
      Description: "DSM Desktop",
      Login: "—",
      Successful: "—",
      Time: "1757894400",
    });
  });

  it("recordings render without start or stop time", async () => {
    await openTab("surveillance");
    const dialog = await runAction("Camera recordings", { "Camera ID": "7" });
    expect(await rowCells("Camera recordings", "46", dialog)).toMatchObject({
      Started: "—",
      Ended: "—",
      Bytes: "887766",
    });
  });

  it("Surveillance Station information renders without a camera count", async () => {
    await openTab("surveillance");
    const dialog = await runAction("Surveillance information");
    expect(await rowCells("Surveillance information", "9", dialog)).toEqual({
      "Major version": "9",
      "Minor version": "2",
      Cameras: "—",
      Licenses: "2",
    });
  });
});
