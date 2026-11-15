import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import AristaFanDialog from "../../src/components/arista/AristaFanDialog";
import {
  openAristaFans,
  closeAristaFans,
  supportsAristaFans,
} from "../../src/components/arista/aristaLauncher";
import type { Connection } from "../../src/types/connection/connection";

const conn = (over: Partial<Connection> = {}): Connection =>
  ({
    id: "c1",
    name: "leaf1",
    protocol: "ssh",
    hostname: "leaf1.example",
    port: 22,
    username: "admin",
    password: "pw",
    isGroup: false,
    ...over,
  }) as Connection;

afterEach(() => {
  act(() => closeAristaFans());
  cleanup();
  vi.clearAllMocks();
});

describe("Arista fan launcher", () => {
  it("applies to ssh/http(s) leaf connections only", () => {
    expect(supportsAristaFans(conn())).toBe(true);
    expect(supportsAristaFans(conn({ protocol: "https" }))).toBe(true);
    expect(supportsAristaFans(conn({ protocol: "rdp" }))).toBe(false);
    expect(supportsAristaFans(conn({ isGroup: true }))).toBe(false);
  });

  it("renders nothing until opened", () => {
    render(<AristaFanDialog />);
    expect(screen.queryByTestId("arista-fan-dialog")).toBeNull();
  });

  it("passes host and credentials per call, using the eAPI not the SSH port", async () => {
    vi.mocked(invoke).mockResolvedValue({
      systemStatus: "coolingOk",
      airflow: null,
      ambientC: null,
      fans: [],
      source: "eapi",
    });
    render(<AristaFanDialog />);
    act(() => openAristaFans(conn({ httpVerifySsl: false })));
    fireEvent.click(await screen.findByText("Read fan speeds"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const [cmd, args] = vi.mocked(invoke).mock.calls[0] as [
      string,
      { config: Record<string, unknown> },
    ];
    expect(cmd).toBe("arista_get_fan_speeds");
    expect(args.config).toMatchObject({
      host: "leaf1.example",
      username: "admin",
      password: "pw",
      useHttps: true,
      insecureTls: true,
    });
    expect(args.config.port).toBeUndefined();
  });
});
