import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import SSHConnectionOverview from "../../src/components/ssh/webTerminal/SSHConnectionOverview";
import type { WebTerminalMgr } from "../../src/components/ssh/webTerminal/types";
import type { ProtocolDiagnosticReport } from "../../src/types/monitoring/diagnostics";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const manager = (overrides: Partial<WebTerminalMgr> = {}) =>
  ({
    status: "error",
    session: { hostname: "nas.example.invalid" },
    connection: { port: 22, username: "fixture" },
    sshConnectionConfig: {},
    sshTerminalConfig: {},
    sshFailure: {
      kind: "host_key",
      summary: "Host key verification failed",
      technicalDetails: "Saved session trust verification failed",
    },
    handleReconnect: vi.fn(),
    ...overrides,
  }) as WebTerminalMgr;

afterEach(() => vi.restoreAllMocks());

describe("SSH connection overview", () => {
  it("keeps repeated host-key probe and connection-failure steps without duplicate React keys", async () => {
    const report: ProtocolDiagnosticReport = {
      host: "nas.example.invalid",
      port: 22,
      protocol: "ssh",
      resolvedIp: null,
      steps: [
        {
          name: "Host Key",
          status: "pass",
          message: "Probe obtained a host key",
          durationMs: 0,
          detail: null,
        },
      ],
      summary: "Probe completed",
      rootCauseHint: null,
      totalDurationMs: 0,
    };
    vi.mocked(invoke).mockResolvedValue(report);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<SSHConnectionOverview mgr={manager()} />);

    fireEvent.click(screen.getByRole("button", { name: "Deep Diagnostics" }));
    await screen.findByText("Probe obtained a host key");
    expect(screen.getByText("Host Key")).toBeInTheDocument();
    expect(
      screen.getByText("Original connection attempt — Host Key"),
    ).toBeInTheDocument();
    expect(screen.getByText("Not timed")).toBeInTheDocument();
    expect(container.querySelectorAll("details > summary")).toHaveLength(3);
    expect(errors).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Deep Diagnostics" }));
    await waitFor(() =>
      expect(
        screen.getByText("Original connection attempt — Host Key"),
      ).toBeInTheDocument(),
    );
    expect(errors).not.toHaveBeenCalled();
  });

  it("explains temporary trust-store transitions and retries verification without credentialed probes", () => {
    const mgr = manager({
      sshFailure: {
        kind: "trust_unavailable",
        summary: "Trust Center unavailable",
        technicalDetails:
          "Host key verification failed: the Trust Center is unavailable (encryption storage transition in progress; retry after it completes). Open a database so host-key decisions can be recorded.",
      } as WebTerminalMgr["sshFailure"],
    });
    vi.mocked(invoke).mockClear();
    render(<SSHConnectionOverview mgr={mgr} />);
    expect(
      screen.getByRole("heading", { name: "Trust Center unavailable" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Wait for the encryption or storage operation to finish.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Open or unlock this connection's owning database."),
    ).not.toBeInTheDocument();
    const diagnostics = screen.getByRole("button", {
      name: "Deep Diagnostics",
    });
    expect(diagnostics).toBeDisabled();
    fireEvent.click(diagnostics);
    expect(invoke).not.toHaveBeenCalled();
    expect(mgr.handleReconnect).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry trust verification" }),
    );
    expect(mgr.handleReconnect).toHaveBeenCalledTimes(1);
  });

  it("shows owning-database recovery only for the database-required reason", () => {
    render(
      <SSHConnectionOverview
        mgr={manager({
          sshFailure: {
            kind: "trust_unavailable",
            summary: "Trust Center unavailable",
            technicalDetails: "SSH_TRUST_UNAVAILABLE[database_required]",
          } as WebTerminalMgr["sshFailure"],
        })}
      />,
    );
    expect(
      screen.getByText("Open or unlock this connection's owning database."),
    ).toBeVisible();
    expect(
      screen.getByText("Wait for the database to finish loading."),
    ).toBeVisible();
  });
});
