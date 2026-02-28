import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Connection } from "../src/types/connection";
import { SSHTerminalOverrides } from "../src/components/connectionEditor/SSHTerminalOverrides";
import { SSHConnectionOverrides } from "../src/components/connectionEditor/SSHConnectionOverrides";

describe("SSH override sections", () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: /Terminal Settings Override/i }),
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

    fireEvent.click(
      screen.getByRole("button", { name: /SSH Connection Settings Override/i }),
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
});
