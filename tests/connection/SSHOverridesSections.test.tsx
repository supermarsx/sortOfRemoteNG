import React, { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Connection } from "../../src/types/connection/connection";
import { SSHTerminalOverrides } from "../../src/components/connectionEditor/SSHTerminalOverrides";
import { SSHConnectionOverrides } from "../../src/components/connectionEditor/SSHConnectionOverrides";

describe("SSH override sections", () => {
  it("counts and resets only overrides shown by the selected panel", () => {
    function Fixture() {
      const [data, setData] = useState<Partial<Connection>>({
        protocol: "ssh",
        sshConnectionConfigOverride: {
          connectTimeout: 15,
          preferredCiphers: ["aes128-ctr"],
        },
      });
      return (
        <>
          <SSHConnectionOverrides
            section="security"
            formData={data}
            setFormData={setData}
          />
          <output data-testid="settings">{JSON.stringify(data)}</output>
        </>
      );
    }
    render(<Fixture />);
    expect(
      screen.getByLabelText("1 custom setting in this panel"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset panel to global" }),
    );
    expect(
      JSON.parse(screen.getByTestId("settings").textContent!)
        .sshConnectionConfigOverride,
    ).toEqual({ connectTimeout: 15 });
    expect(
      screen.queryByLabelText("1 custom setting in this panel"),
    ).not.toBeInTheDocument();
  });
  const baseData: Partial<Connection> = {
    id: "conn-1",
    protocol: "ssh",
    isGroup: false,
  };

  it("uses centralized classes in terminal override controls", () => {
    const { container } = render(
      <SSHTerminalOverrides
        formData={{
          ...baseData,
          sshTerminalConfigOverride: {
            useCustomFont: true,
            font: {
              family: "Consolas",
              size: 14,
              weight: "normal",
              style: "normal",
              lineHeight: 1.2,
              letterSpacing: 0,
            },
          },
        }}
        setFormData={vi.fn()}
      />,
    );

    expect(screen.getByText("Font").className).toContain(
      "sor-form-section-heading",
    );
    expect(screen.getByLabelText("Use Custom Font").className).toContain(
      "sor-form-checkbox",
    );
    expect(container.querySelector('input[type="text"]')?.className).toContain(
      "sor-form-input-sm",
    );
  });

  it("uses centralized classes in connection override controls", () => {
    const { container } = render(
      <SSHConnectionOverrides
        formData={{
          ...baseData,
          sshConnectionConfigOverride: {
            connectTimeout: 30,
          },
        }}
        setFormData={vi.fn()}
      />,
    );

    expect(screen.getByText("Connection").className).toContain(
      "sor-form-section-heading",
    );
    expect(screen.getByLabelText("Connect Timeout").className).toContain(
      "sor-form-checkbox",
    );
    expect(
      container.querySelector('input[type="number"]')?.className,
    ).toContain("sor-form-input-sm");
  });
  it("keeps SSH panels open and edits algorithm priority with an explicit reset to inheritance", () => {
    function Fixture() {
      const [data, setData] = useState<Partial<Connection>>({
        ...baseData,
        sshTerminalConfigOverride: {
          preferredKeyExchanges: [
            "curve25519-sha256",
            "diffie-hellman-group14-sha256",
          ],
        },
      });
      return (
        <>
          <SSHConnectionOverrides
            section="security"
            formData={data}
            setFormData={setData}
          />
          <output data-testid="protocol-data">{JSON.stringify(data)}</output>
        </>
      );
    }
    render(<Fixture />);
    expect(
      screen.queryByRole("button", { name: "SSH security & algorithms" }),
    ).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Key Exchange" });
    fireEvent.click(
      within(group).getByRole("button", {
        name: "Move diffie-hellman-group14-sha256 up",
      }),
    );
    let saved = JSON.parse(screen.getByTestId("protocol-data").textContent!);
    expect(saved.sshConnectionConfigOverride.preferredKeyExchanges).toEqual([
      "diffie-hellman-group14-sha256",
      "curve25519-sha256",
    ]);
    expect(
      saved.sshTerminalConfigOverride?.preferredKeyExchanges,
    ).toBeUndefined();
    fireEvent.click(screen.getByLabelText("Key Exchanges"));
    saved = JSON.parse(screen.getByTestId("protocol-data").textContent!);
    expect(
      saved.sshConnectionConfigOverride?.preferredKeyExchanges,
    ).toBeUndefined();
    expect(
      screen.queryByRole("group", { name: "Key Exchange" }),
    ).not.toBeInTheDocument();
  });
});
