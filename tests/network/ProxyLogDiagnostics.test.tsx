import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProxyLogsTab } from "../../src/components/network/InternalProxyManager";
import type {
  useInternalProxyManager,
  ProxyRequestLogEntry,
} from "../../src/hooks/network/useInternalProxyManager";
import type { ProxyLogDiagnostic } from "../../src/utils/network/proxyLogDiagnostic";

const detail: ProxyLogDiagnostic = {
  lane: "direct_probe",
  phase: "quickconnect_direct_probe",
  stage: "connect_tls",
  code: "quickconnect_tls_failed",
  outcome: "failed",
  durationMs: 123,
  queueMs: 4,
  activeMs: 119,
  attemptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  hop: 2,
  upstreamStatus: 502,
};
const entry: ProxyRequestLogEntry = {
  id: "1",
  session_id: "s",
  method: "GET",
  url: "https://fixture.test/",
  timestamp: "2026-09-13T09:00:00Z",
  status: 502,
  error: null,
};
function show(value: unknown) {
  return render(
    <ProxyLogsTab
      mgr={
        {
          requestLog: [{ ...entry, diagnostic: value }],
          handleClearLog: vi.fn(),
        } as unknown as ReturnType<typeof useInternalProxyManager>
      }
    />,
  );
}
describe("readable proxy request diagnostics", () => {
  it("explains document HTTP cycles with safe redirect evidence rather than calling the server unreachable", () => {
    show({
      ...detail,
      phase: "quickconnect_redirect",
      stage: "handoff",
      outcome: "failed",
      code: "quickconnect_redirect_loop",
      upstreamStatus: 302,
      redirectSourcePath: "root",
      redirectTargetPath: "dsm",
      redirectTargetOrigin: "https://destination.test",
      redirectQueryRemoved: true,
      sameOriginRedirects: 2,
    });
    fireEvent.click(screen.getByRole("button", { name: /fixture.test/ }));
    const diagnostics = screen.getByRole("region", {
      name: "Request diagnostics",
    });
    for (const text of [
      "Upstream HTTP302",
      "Redirect source originhttps://fixture.test",
      "Redirect destination originhttps://destination.test",
      "Source path categoryRoot",
      "Destination path categoryDSM",
      "Internal same-origin redirects2",
      "Query or fragment removedYes",
      "HTTP redirect cycle",
      "does not mean the server was unreachable",
      "before the proxy's local handoff response",
    ])
      expect(diagnostics).toHaveTextContent(text);
    expect(diagnostics).not.toHaveTextContent(
      "A failed candidate can be expected",
    );
  });
  it("keeps a successful relay probe distinct from the subsequent document outcome", () => {
    show({
      ...detail,
      phase: "quickconnect_relay_probe",
      stage: "complete",
      code: "quickconnect_upstream_status",
      outcome: "succeeded",
      upstreamStatus: 200,
    });
    fireEvent.click(screen.getByRole("button", { name: /fixture.test/ }));
    const diagnostics = screen.getByRole("region", {
      name: "Request diagnostics",
    });
    expect(diagnostics).toHaveTextContent(
      "Relay candidate · Request completed",
    );
    expect(diagnostics).toHaveTextContent("not the final connection result");
    expect(diagnostics).not.toHaveTextContent("Redirect destination origin");
  });
  it("shows compact phase/outcome/timing and detailed safe failure context", () => {
    show(detail);
    expect(
      screen.getByText(/Direct NAS candidate · Request failed · 123 ms/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /fixture.test/ }));
    const diagnostics = screen.getByRole("region", {
      name: "Request diagnostics",
    });
    expect(diagnostics).toHaveTextContent("Connecting / TLS");
    expect(diagnostics).toHaveTextContent("Queue wait4 ms");
    expect(diagnostics).toHaveTextContent("Transport laneDirect probe");
    expect(diagnostics).toHaveTextContent("Active exchange119 ms");
    expect(diagnostics).toHaveTextContent(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(diagnostics).toHaveTextContent(
      "The verified TLS connection could not be established",
    );
    expect(diagnostics).toHaveTextContent("not the final connection result");
    expect(diagnostics).toHaveTextContent(
      "not full page readiness or successful sign-in",
    );
  });
  it.each([
    undefined,
    { ...detail, code: "private-error", headers: { Cookie: "private-cookie" } },
  ])(
    "retains legacy row details while ignoring unavailable/unrecognized metadata",
    (value) => {
      show(value);
      fireEvent.click(screen.getByRole("button", { name: /fixture.test/ }));
      expect(
        screen.queryByRole("region", { name: "Request diagnostics" }),
      ).toBeNull();
      expect(screen.getByTestId("log-copy-url")).toBeVisible();
      expect(document.body).not.toHaveTextContent("private-");
    },
  );
  it("shows pending review as review, not completed sign-in or terminal failure", () => {
    show({
      ...detail,
      phase: "quickconnect_redirect",
      stage: "handoff",
      outcome: "review_required",
      code: "quickconnect_redirect_pending",
    });
    expect(
      screen.getByText(/QuickConnect handoff · Review required/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /fixture.test/ }));
    expect(
      screen.getByRole("region", { name: "Request diagnostics" }),
    ).toHaveTextContent("preparing a reviewed destination handoff");
    expect(screen.queryByText(/A failed candidate can be expected/)).toBeNull();
  });
});
