import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Connection } from "../../types/connection/connection";
import {
  CONNECTION_EDITOR_SEARCH_DESCRIPTORS,
  type ConnectionEditorSearchDescriptor,
} from "../connection/editor/editorRegistry";
import BMCOptions, {
  type BmcEditorProtocol,
  type BmcOptionsSection,
} from "./BMCOptions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }): string =>
      typeof fallback === "string" ? fallback : (fallback?.defaultValue ?? key),
  }),
}));

const Harness: React.FC<{
  initial: Partial<Connection>;
  section?: BmcOptionsSection;
}> = ({ initial, section }) => {
  const [formData, setFormData] = useState<Partial<Connection>>(initial);
  return (
    <>
      <BMCOptions
        formData={formData}
        setFormData={setFormData}
        section={section}
      />
      <output data-testid="bmc-form-state">{JSON.stringify(formData)}</output>
    </>
  );
};

const formState = (): Partial<Connection> =>
  JSON.parse(screen.getByTestId("bmc-form-state").textContent ?? "{}");

const isBmcEditorProtocol = (protocol: string): protocol is BmcEditorProtocol =>
  protocol === "idrac" ||
  protocol === "ilo" ||
  protocol === "lenovo" ||
  protocol === "supermicro";

describe("BMCOptions", () => {
  it.each([
    ["idrac", false, false, false],
    ["ilo", true, true, true],
    ["lenovo", true, true, false],
    ["supermicro", false, false, true],
  ] as const)(
    "renders only schema-backed %s provider controls",
    (protocol, hasGeneration, hasIpmiPort, hasAuthMethod) => {
      const { container } = render(
        <Harness initial={{ protocol, isGroup: false }} />,
      );

      expect(container.querySelector("#bmc-transport")).not.toBeNull();
      expect(container.querySelector("#bmc-timeout")).not.toBeNull();
      expect(
        screen.getByRole("checkbox", { name: "Verify server certificate" }),
      ).toBeInTheDocument();
      expect(Boolean(container.querySelector("#bmc-generation"))).toBe(
        hasGeneration,
      );
      expect(Boolean(container.querySelector("#bmc-ipmi-port"))).toBe(
        hasIpmiPort,
      );
      expect(Boolean(container.querySelector("#bmc-auth-method"))).toBe(
        hasAuthMethod,
      );
      expect(Boolean(container.querySelector("#bmc-platform"))).toBe(
        protocol === "supermicro",
      );
      expect(container.querySelector('input[type="password"]')).toBeNull();
    },
  );

  it("keeps absent Lenovo defaults implicit and writes the flat adapter settings shape", () => {
    const { container } = render(
      <Harness
        initial={{
          protocol: "lenovo",
          isGroup: false,
          password: "saved-only-on-the-connection",
        }}
      />,
    );

    expect(formState().lenovoSettings).toBeUndefined();
    expect(
      (container.querySelector("#bmc-transport") as HTMLSelectElement).value,
    ).toBe("");
    expect(
      (container.querySelector("#bmc-ipmi-port") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (container.querySelector("#bmc-timeout") as HTMLInputElement).value,
    ).toBe("");

    fireEvent.change(container.querySelector("#bmc-transport")!, {
      target: { value: "legacyRest" },
    });
    fireEvent.change(container.querySelector("#bmc-generation")!, {
      target: { value: "xcc2" },
    });
    fireEvent.change(container.querySelector("#bmc-ipmi-port")!, {
      target: { value: "624" },
    });
    const verifyCertificate = screen.getByRole("checkbox", {
      name: "Verify server certificate",
    });
    expect(verifyCertificate).toBeChecked();
    fireEvent.click(verifyCertificate);
    fireEvent.click(verifyCertificate);
    fireEvent.change(container.querySelector("#bmc-timeout")!, {
      target: { value: "45" },
    });

    const state = formState();
    expect(state.password).toBe("saved-only-on-the-connection");
    expect(state.lenovoSettings).toEqual({
      protocol: "legacyRest",
      generation: "xcc2",
      ipmiPort: 624,
      insecure: false,
      timeoutSecs: 45,
    });
    expect(state.lenovoSettings).not.toHaveProperty("config");
    expect(state.lenovoSettings).not.toHaveProperty("password");
  });

  it("preserves imported iLO fields while editing provider authentication", () => {
    const { container } = render(
      <Harness
        initial={{
          protocol: "ilo",
          iloSettings: {
            protocol: "ipmi",
            generation: "ilo4",
            insecure: false,
            timeoutSecs: 61,
            ipmiPort: 700,
            authMethod: "session",
          },
        }}
      />,
    );

    fireEvent.change(container.querySelector("#bmc-auth-method")!, {
      target: { value: "basic" },
    });

    expect(formState().iloSettings).toEqual({
      protocol: "ipmi",
      generation: "ilo4",
      insecure: false,
      timeoutSecs: 61,
      ipmiPort: 700,
      authMethod: "basic",
    });
  });

  it("writes only typed Supermicro transport, platform, auth, trust, and timeout fields", () => {
    const { container } = render(
      <Harness initial={{ protocol: "supermicro" }} />,
    );

    fireEvent.change(container.querySelector("#bmc-transport")!, {
      target: { value: "http" },
    });
    fireEvent.change(container.querySelector("#bmc-platform")!, {
      target: { value: "x13" },
    });
    fireEvent.change(container.querySelector("#bmc-auth-method")!, {
      target: { value: "basic" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Verify server certificate" }),
    );
    fireEvent.change(container.querySelector("#bmc-timeout")!, {
      target: { value: "90" },
    });

    expect(formState().supermicroSettings).toEqual({
      useSsl: false,
      platform: "x13",
      authMethod: "basic",
      verifyCert: true,
      timeoutSecs: 90,
    });
  });

  it("indexes every BMC editor field without indexing a provider password", () => {
    const protocolOptions: ConnectionEditorSearchDescriptor | undefined =
      CONNECTION_EDITOR_SEARCH_DESCRIPTORS.find(
        (descriptor) => descriptor.id === "protocol-options",
      );
    const fields = protocolOptions?.fields.filter((field) =>
      field.protocols?.some(isBmcEditorProtocol),
    );

    expect(fields?.map((field) => field.id)).toEqual(
      expect.arrayContaining([
        "bmc-transport",
        "bmc-generation",
        "bmc-platform",
        "bmc-auth-method",
        "bmc-certificate-verification",
        "bmc-ipmi-port",
        "bmc-timeout",
      ]),
    );
    expect(JSON.stringify(fields)).not.toContain("password");
  });
});
