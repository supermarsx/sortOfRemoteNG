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
  DiskInfo,
  HotSpare,
  SmartAttribute,
  SmartInfo,
  SsdCache,
  StoragePool,
  VolumeInfo,
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
const disks: Required<DiskInfo>[] = [
  {
    id: "sata1",
    name: "Drive 1",
    device: "/dev/sata1",
    model: "SYNTH-HDD-8T",
    vendor: "Synth",
    serial: null,
    firmware: "SC61",
    sizeTotal: 8001563222016,
    temp: 36,
    status: "normal",
    smartStatus: "normal",
    diskType: "SATA",
    exceedBadSectorThr: false,
    intf: "sata",
    container: { pool: "reuse_1", volume: null, type: "internal" },
  },
  {
    id: "sata2",
    name: "Drive 2",
    device: "/dev/sata2",
    model: "SYNTH-HDD-4T",
    vendor: null,
    serial: null,
    firmware: null,
    sizeTotal: 4000787030016,
    temp: null,
    status: "initialized",
    smartStatus: null,
    diskType: null,
    exceedBadSectorThr: null,
    intf: null,
    container: null,
  },
];
const volumes: Required<VolumeInfo>[] = [
  {
    id: "volume_1",
    displayName: "volume1",
    status: "normal",
    fsType: "btrfs",
    sizeTotal: 28788160495616,
    sizeUsed: 7632707117056,
    sizeFree: 21155453378560,
    usagePercent: 26.51,
    poolPath: "reuse_1",
    desc: null,
    container: "internal",
  },
  {
    id: "volume_2",
    displayName: null,
    status: "crashed",
    fsType: null,
    sizeTotal: 0,
    sizeUsed: 0,
    sizeFree: 0,
    usagePercent: null,
    poolPath: null,
    desc: null,
    container: null,
  },
];
const storagePools: Required<StoragePool>[] = [
  {
    id: "reuse_1",
    status: "normal",
    raidType: "raid_6",
    sizeTotal: 31998929895424,
    sizeUsed: 29988443455488,
    disks: ["sata1", "sata2"],
    desc: "Primary pool",
  },
  {
    id: "reuse_2",
    status: "degraded",
    raidType: null,
    sizeTotal: null,
    sizeUsed: null,
    disks: [],
    desc: null,
  },
];
const ssdCaches: Required<SsdCache>[] = [
  {
    id: "cache_1",
    status: "normal",
    size: 107374182400,
    readHit: 37,
    disks: ["nvme0n1", "nvme1n1"],
  },
  { id: "cache_2", status: "normal", size: 1, readHit: null, disks: [] },
];
const hotSpares: Required<HotSpare>[] = [
  { diskId: "sata4", poolId: "reuse_1" },
  { diskId: "sata5", poolId: null },
];
const attribute: Required<SmartAttribute> = {
  id: 5,
  name: "Reallocated_Sector_Ct",
  current: 100,
  worst: 99,
  threshold: 10,
  raw: "0",
  status: "OK",
};
const smart: Record<string, Required<SmartInfo>> = {
  sata1: {
    diskId: "sata1",
    diskName: "Drive 1",
    healthStatus: "normal",
    temperature: 36,
    powerOnHours: 21903,
    reallocatedSectors: 0,
    attributes: [attribute],
  },
  sata2: {
    diskId: "sata2",
    diskName: null,
    healthStatus: null,
    temperature: 41,
    powerOnHours: null,
    reallocatedSectors: null,
    attributes: null,
  },
};

beforeEach(() =>
  vi
    .mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      switch (command) {
        case "syn_get_section_access":
          return {
            section: (args as { section: string }).section,
            status: "available",
            reason: "Primary section read succeeded.",
          };
        case "syn_fs_list":
          return {
            files: [{ path: "/public", name: "public", isdir: true }],
            total: 1,
            offset: 0,
          };
        case "syn_list_disks":
          return disks;
        case "syn_list_volumes":
          return volumes;
        case "syn_get_storage_overview":
          return { disks, volumes, storagePools, ssdCaches, hotSpares };
        case "syn_get_smart_info":
          return smart[(args as { diskId: string }).diskId];
        default:
          return null;
      }
    }),
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
const openStorage = async () => {
  render(<SynologySessionContent connection={connection()} />);
  const button = screen.getByTestId("synology-tab-storage");
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
/** The table section whose heading is `title (count)`. */
const tableSection = (title: string) => {
  const heading = screen
    .getAllByRole("heading", { level: 3 })
    .find(
      (item) => item.textContent?.replace(/\s*\(\d+\)$/, "").trim() === title,
    );
  if (!heading) throw new Error(`No "${title}" table`);
  return heading.closest("section") as HTMLElement;
};
const headers = (title: string) =>
  within(tableSection(title))
    .getAllByRole("columnheader")
    .map((header) => header.textContent ?? "");
/** Cell text by column label for the row whose cell text is exactly `rowText`. */
const rowCells = async (title: string, rowText: string) => {
  await waitFor(() =>
    expect(
      within(tableSection(title)).getByText(rowText, { selector: "td" }),
    ).toBeInTheDocument(),
  );
  const section = tableSection(title);
  const row = within(section)
    .getByText(rowText, { selector: "td" })
    .closest("tr") as HTMLElement;
  const values = Array.from(
    row.querySelectorAll("td"),
    (cell) => cell.textContent ?? "",
  );
  return Object.fromEntries(
    headers(title).map((label, i) => [label, values[i]]),
  );
};
const expectNoFailure = () => {
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("synology-read-failures"),
  ).not.toBeInTheDocument();
};

describe("Storage overview columns read the native DTO keys", () => {
  it("storage pools show total and used bytes, and unknown sizes render as unknown", async () => {
    await openStorage();
    expect(await rowCells("Storage pools", "reuse_1")).toEqual({
      ID: "reuse_1",
      Status: "normal",
      RAID: "raid_6",
      "Total bytes": "31998929895424",
      "Used bytes": "29988443455488",
      Disks: "sata1, sata2",
    });
    expect(await rowCells("Storage pools", "reuse_2")).toEqual({
      ID: "reuse_2",
      Status: "degraded",
      RAID: "—",
      "Total bytes": "—",
      "Used bytes": "—",
      Disks: "—",
    });
    expectNoFailure();
  });

  it("SSD caches show the read hit rate and member disks, with no write-hit column", async () => {
    await openStorage();
    expect(await rowCells("SSD caches", "cache_1")).toEqual({
      ID: "cache_1",
      Status: "normal",
      Bytes: "107374182400",
      "Read hit rate %": "37",
      Disks: "nvme0n1, nvme1n1",
    });
    expect(await rowCells("SSD caches", "cache_2")).toEqual({
      ID: "cache_2",
      Status: "normal",
      Bytes: "1",
      "Read hit rate %": "—",
      Disks: "—",
    });
    expect(headers("SSD caches")).not.toContain("Write hits");
    expectNoFailure();
  });

  it("hot spares show the pool they protect", async () => {
    await openStorage();
    expect(await rowCells("Hot spares", "sata4")).toEqual({
      Disk: "sata4",
      Pool: "reuse_1",
    });
    expect(await rowCells("Hot spares", "sata5")).toEqual({
      Disk: "sata5",
      Pool: "—",
    });
    expectNoFailure();
  });
});

describe("Disk, volume and SMART columns read the native DTO keys", () => {
  it("disks and volumes render reported values and unknowns", async () => {
    await openStorage();
    expect(await rowCells("Disks", "sata1")).toEqual({
      ID: "sata1",
      Name: "Drive 1",
      Model: "SYNTH-HDD-8T",
      Bytes: "8001563222016",
      "Temperature °C": "36",
      Status: "normal",
      SMART: "normal",
      Actions: "SMART details",
    });
    expect(await rowCells("Disks", "sata2")).toMatchObject({
      "Temperature °C": "—",
      Status: "initialized",
      SMART: "—",
    });
    expect(await rowCells("Volumes", "volume_1")).toEqual({
      ID: "volume_1",
      Name: "volume1",
      Status: "normal",
      Filesystem: "btrfs",
      "Total bytes": "28788160495616",
      "Used bytes": "7632707117056",
      "Free bytes": "21155453378560",
      "Used %": "26.51",
    });
    expect(await rowCells("Volumes", "volume_2")).toEqual({
      ID: "volume_2",
      Name: "—",
      Status: "crashed",
      Filesystem: "—",
      "Total bytes": "0",
      "Used bytes": "0",
      "Free bytes": "0",
      "Used %": "—",
    });
    expectNoFailure();
  });

  it("SMART details render health and attribute values", async () => {
    await openStorage();
    const row = (await screen.findByText("sata1", { selector: "td" })).closest(
      "tr",
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "SMART details" }));
    expect(await rowCells("SMART health", "Drive 1")).toEqual({
      Disk: "Drive 1",
      Health: "normal",
      "Temperature °C": "36",
      "Power-on hours": "21903",
      "Reallocated sectors": "0",
    });
    expect(await rowCells("SMART attributes", "Reallocated_Sector_Ct")).toEqual(
      {
        ID: "5",
        Name: "Reallocated_Sector_Ct",
        Current: "100",
        Worst: "99",
        Threshold: "10",
        "Raw value": "0",
        Status: "OK",
      },
    );
    expectNoFailure();
  });

  it("SMART details without a name, health or attributes render as unknown", async () => {
    await openStorage();
    const row = (await screen.findByText("sata2", { selector: "td" })).closest(
      "tr",
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "SMART details" }));
    expect(await rowCells("SMART health", "41")).toEqual({
      Disk: "—",
      Health: "—",
      "Temperature °C": "41",
      "Power-on hours": "—",
      "Reallocated sectors": "—",
    });
    expect(
      within(tableSection("SMART attributes")).queryAllByRole("row"),
    ).toHaveLength(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "syn_get_smart_info",
      expect.objectContaining({ diskId: "sata2" }),
    );
    expectNoFailure();
  });
});
