import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PowerShellRemotingSettings } from "../../../types/powershellRemoting";
import { createDefaultPowerShellRemotingSettings } from "../../../utils/powershell/normalizePowerShellRemoting";
import { PowerShellRemotingEditor } from "./PowerShellRemotingEditor";

function Harness({
  initial = createDefaultPowerShellRemotingSettings(),
}: {
  initial?: PowerShellRemotingSettings;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PowerShellRemotingEditor
        targetHost="server.example.test"
        value={value}
        onChange={setValue}
        networkPathSummary="Direct → server.example.test"
      />
      <output data-testid="powershell-state">{JSON.stringify(value)}</output>
    </>
  );
}

describe("PowerShellRemotingEditor", () => {
  it("composes rapid nested endpoint, credential, and session edits before rerender", () => {
    const onChange = vi.fn();
    render(
      <PowerShellRemotingEditor
        targetHost="server.example.test"
        value={createDefaultPowerShellRemotingSettings()}
        onChange={onChange}
      />,
    );

    const changeRapidly = (label: string, values: readonly string[]) => {
      const input = screen.getByLabelText(label);
      values.forEach((value) => fireEvent.change(input, { target: { value } }));
    };

    changeRapidly("PowerShell username", ["a", "al", "ali", "alice"]);
    changeRapidly("PowerShell domain", ["E", "EX", "EXAMPLE"]);
    changeRapidly("WSMan path", ["/", "/c", "/custom-wsman"]);
    fireEvent.change(screen.getByLabelText("WSMan port"), {
      target: { value: "15986" },
    });
    fireEvent.change(screen.getByLabelText("Operation timeout seconds"), {
      target: { value: "240" },
    });

    expect(onChange.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        credential: expect.objectContaining({
          username: "alice",
          domain: "EXAMPLE",
        }),
        wsman: expect.objectContaining({
          path: "/custom-wsman",
          port: 15_986,
        }),
        session: expect.objectContaining({ operationTimeoutSec: 240 }),
      }),
    );
  });

  it("renders flat, separately named sections without accordion controls", () => {
    render(<Harness />);

    for (const name of [
      "Endpoint",
      "Authentication",
      "Security",
      "SSH",
      "Network Path",
      "Session",
      "Windows Tools",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(
      document.querySelector("[data-powershell-section] button[aria-controls]"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/persistent PSRP over SSH or direct WSMan/i),
    ).toBeInTheDocument();
  });

  it("blocks Basic over HTTP in both the field and page validation", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.wsman.scheme = "http";
    settings.wsman.port = 5985;
    settings.wsman.authMethod = "basic";
    render(<Harness initial={settings} />);

    expect(
      screen.getAllByText(/Basic authentication is blocked over HTTP/i).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /blocking PowerShell setting/i,
    );
  });

  it("enables direct WSMan and strict SSH while unsupported auth and trust choices fail closed", () => {
    render(<Harness />);

    const transport = screen.getByRole("combobox", {
      name: "PowerShell remoting transport",
    });
    fireEvent.click(transport);
    expect(
      screen.getByRole("option", { name: /WSMan — direct only/i }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: "PowerShell over SSH" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "PowerShell over SSH" }),
    );
    expect(
      screen.getByRole("group", { name: "PowerShell over SSH settings" }),
    ).not.toBeDisabled();

    const sshAuth = screen.getByRole("combobox", {
      name: "PowerShell SSH authentication",
    });
    fireEvent.click(sshAuth);
    expect(
      screen.getByRole("option", { name: /SSH agent — unavailable/i }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sshAuth);

    fireEvent.click(
      screen.getByRole("combobox", { name: "SSH host-key trust mode" }),
    );
    expect(
      screen.getByRole("option", { name: /Trust on first use — unavailable/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps Windows Tools explicitly separate and persists endpoint/session edits", () => {
    render(<Harness />);

    expect(
      screen.getByText(
        /WMI and Windows management tools are separate from PowerShell Remoting/i,
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("WSMan port"), {
      target: { value: "15986" },
    });
    fireEvent.change(screen.getByLabelText("Operation timeout seconds"), {
      target: { value: "240" },
    });
    fireEvent.click(
      screen.getByLabelText("Enable separate Windows management tools"),
    );

    expect(screen.getByTestId("powershell-state")).toHaveTextContent(
      '"port":15986',
    );
    expect(screen.getByTestId("powershell-state")).toHaveTextContent(
      '"operationTimeoutSec":240',
    );
    expect(screen.getByTestId("powershell-state")).toHaveTextContent(
      '"windowsTools":{"enabled":true,"settingsSource":"separateWinrmSettings"}',
    );
  });
});
