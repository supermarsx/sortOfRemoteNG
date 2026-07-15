import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
    expect(screen.getByText(/legacy WinRS process shell/i)).toBeInTheDocument();
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

  it("disables unsupported SSH, CredSSP, and certificate choices with reasons", () => {
    render(<Harness />);

    expect(
      screen.getByRole("group", { name: "PowerShell over SSH settings" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("group", { name: "WSMan proxy settings" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("Client certificate credential reference"),
    ).toBeDisabled();
    expect(
      screen.getByText(/SSH is unavailable.*placeholder/i),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "PowerShell authentication method",
      }),
    );
    expect(
      screen.getByRole("option", { name: /CredSSP — unavailable/i }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: /Client certificate — unavailable/i }),
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
