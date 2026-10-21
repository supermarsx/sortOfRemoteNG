import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolkitResults } from "../../src/components/network/toolkit/ToolkitResults";
import type { ToolkitReport } from "../../src/types/network/networkToolkit";
afterEach(cleanup);
const base = {
  jobId: "fixture",
  startedAt: "2026-10-21T12:00:00Z",
  durationMs: 25,
  route: "direct" as const,
};
describe("readable toolkit results by default", () => {
  it("shows provider failures beside their resolved IPs without a false clean result", () => {
    render(
      <ToolkitResults
        report={{
          ...base,
          tool: "rbl",
          data: {
            target: "mail.example.test",
            resolvedAddresses: ["192.0.2.1", "2001:db8::1"],
            results: [
              { ip: "192.0.2.1", zone: "provider.test", status: "listed" },
              {
                ip: "2001:db8::1",
                zone: "provider.test",
                status: "error",
                error: "Resolver timed out",
              },
            ],
          },
        }}
      />,
    );
    const table = within(
      screen.getByRole("table", { name: "Blocklist results" }),
    );
    expect(table.getByText("192.0.2.1")).toBeVisible();
    expect(table.getByText("2001:db8::1")).toBeVisible();
    expect(table.getByText("Listed")).toBeVisible();
    expect(table.getByText("Lookup failed")).toBeVisible();
    expect(table.queryByText("Not listed")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Result format" }),
    ).toHaveTextContent("Readable results");
  });
  it("renders HTTP content as text and presents status and redirect details", () => {
    const report: ToolkitReport = {
      ...base,
      tool: "website",
      data: {
        status: 503,
        url: "https://example.test",
        hops: [
          {
            url: "https://example.test",
            status: 503,
            headers: [{ name: "retry-after", value: "60" }],
          },
        ],
        bodyText: '<img src="https://evil.test" onerror="alert(1)">',
      },
    };
    const { container } = render(<ToolkitResults report={report} />);
    expect(screen.getByText(/<img src=/)).toBeVisible();
    expect(screen.getByText("retry-after")).toBeVisible();
    expect(container.querySelector("img,script,iframe")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeEnabled();
  });
});
