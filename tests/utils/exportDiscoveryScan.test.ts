import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportDiscoveryScanCsv } from "../../src/utils/discovery/exportDiscoveryScan";
import type { SavedDiscoveryScan } from "../../src/utils/discovery/scanHistory";

const hosts = [
  {
    ip: "192.0.2.10",
    hostname: "=FORMULA()",
    openPorts: [22],
    services: [{ port: 22, protocol: "ssh", service: "SSH" }],
    responseTime: 2,
  },
];
const scan = {
  id: "scan-123",
  name: "Office / servers",
  hosts,
} as SavedDiscoveryScan;
const create = vi.fn<(blob: Blob) => string>(() => "blob:history-export");
const revoke = vi.fn();
let clicked: { name: string; url: string } | undefined;
beforeEach(() => {
  create.mockClear();
  revoke.mockClear();
  clicked = undefined;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked = { name: this.download, url: this.href };
    expect(this.isConnected).toBe(true);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const read = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
describe("saved scan CSV export", () => {
  it("downloads that snapshot with its safe renamed filename and sanitized spreadsheet cells", async () => {
    exportDiscoveryScanCsv(scan);
    const csv = await read(create.mock.calls[0][0]);
    expect(csv).toContain("192.0.2.10,'=FORMULA()");
    expect(clicked).toEqual({
      name: "network-scan-Office-servers.csv",
      url: "blob:history-export",
    });
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:history-export");
  });
  it("supports a filtered snapshot export without modifying saved hosts", async () => {
    exportDiscoveryScanCsv({ ...scan, name: undefined }, []);
    expect(await read(create.mock.calls[0][0])).not.toContain("192.0.2.10");
    expect(clicked?.name).toBe("network-scan-scan-123.csv");
    expect(scan.hosts).toHaveLength(1);
  });
  it("releases download resources even if the browser fails to initiate it", () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
      throw new Error("Download failed");
    });
    expect(() => exportDiscoveryScanCsv(scan)).toThrow("Download failed");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:history-export");
  });
});
