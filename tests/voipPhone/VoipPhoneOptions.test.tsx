import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import VoipPhoneOptions, {
  type VoipPhoneOptionsSection,
} from "../../src/components/connectionEditor/VoipPhoneOptions";
import {
  CONNECTION_EDITOR_SEARCH_DESCRIPTORS,
  type ConnectionEditorSearchFieldDescriptor,
} from "../../src/components/connection/editor/editorRegistry";
import type { Connection } from "../../src/types/connection/connection";
import { normalizeVoipPhoneSettings } from "../../src/types/voipPhone";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }): string =>
      typeof fallback === "string" ? fallback : (fallback?.defaultValue ?? key),
  }),
}));

const Harness: React.FC<{
  initial: Partial<Connection>;
  section?: VoipPhoneOptionsSection;
}> = ({ initial, section }) => {
  const [formData, setFormData] = useState<Partial<Connection>>(initial);
  return (
    <>
      <VoipPhoneOptions
        formData={formData}
        setFormData={setFormData}
        section={section}
      />
      <output data-testid="voip-form-state">{JSON.stringify(formData)}</output>
    </>
  );
};

const formState = (): Partial<Connection> =>
  JSON.parse(screen.getByTestId("voip-form-state").textContent ?? "{}");

describe("VoipPhoneOptions", () => {
  it("renders nothing for other protocols or groups", () => {
    const { container, rerender } = render(
      <Harness initial={{ protocol: "ssh", isGroup: false }} />,
    );
    expect(container.querySelector("#voip-phone-vendor")).toBeNull();
    rerender(<Harness initial={{ protocol: "voip-phone", isGroup: true }} />);
    expect(container.querySelector("#voip-phone-vendor")).toBeNull();
  });

  it("renders every section with defaults and no password field", () => {
    const { container } = render(
      <Harness initial={{ protocol: "voip-phone", isGroup: false }} />,
    );

    const vendor = screen.getByTestId("voip-phone-vendor") as HTMLSelectElement;
    expect(vendor.value).toBe("yealink");
    expect(Array.from(vendor.options).map((o) => o.value)).toEqual(["yealink"]);
    expect(
      (screen.getByTestId("voip-phone-auth-mode") as HTMLSelectElement).value,
    ).toBe("auto");
    expect(
      screen.getByRole("checkbox", { name: "Use HTTPS" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Verify server certificate" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Action URI enabled on the phone" }),
    ).not.toBeChecked();
    expect(screen.getByText(/Remote Control/)).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it.each([
    ["connection", "#voip-phone-vendor"],
    ["authentication", "#voip-phone-auth-mode"],
    ["security", "[data-editor-search-field='voip-phone-tls']"],
    ["advanced", "#voip-phone-timeout"],
  ] as const)(
    "section %s renders only its own controls",
    (section, selector) => {
      const { container } = render(
        <Harness
          initial={{ protocol: "voip-phone", isGroup: false }}
          section={section}
        />,
      );
      expect(container.querySelector(selector)).not.toBeNull();
      for (const [other, otherSelector] of [
        ["connection", "#voip-phone-vendor"],
        ["authentication", "#voip-phone-auth-mode"],
        ["security", "[data-editor-search-field='voip-phone-tls']"],
        ["advanced", "#voip-phone-timeout"],
      ] as const) {
        if (other === section) continue;
        expect(container.querySelector(otherSelector), other).toBeNull();
      }
    },
  );

  it("writes only the non-secret voipPhoneSettings block", () => {
    render(
      <Harness
        initial={{
          protocol: "voip-phone",
          isGroup: false,
          username: "admin",
          password: "sentinel-secret",
        }}
      />,
    );

    fireEvent.change(screen.getByTestId("voip-phone-auth-mode"), {
      target: { value: "form" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Use HTTPS" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Verify server certificate" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Action URI enabled on the phone" }),
    );
    fireEvent.change(screen.getByTestId("voip-phone-timeout"), {
      target: { value: "30" },
    });

    const state = formState();
    expect(state.voipPhoneSettings).toEqual({
      vendor: "yealink",
      authMode: "form",
      useSsl: true,
      verifyCert: false,
      actionUriEnabled: true,
      timeoutSecs: 30,
    });
    expect(JSON.stringify(state.voipPhoneSettings)).not.toContain(
      "sentinel-secret",
    );
    expect(state.password).toBe("sentinel-secret");

    fireEvent.change(screen.getByTestId("voip-phone-timeout"), {
      target: { value: "" },
    });
    expect(formState().voipPhoneSettings?.timeoutSecs).toBeUndefined();
  });

  it("normalizes missing settings to safe defaults", () => {
    expect(normalizeVoipPhoneSettings(undefined)).toEqual({
      vendor: "yealink",
      useSsl: false,
      verifyCert: true,
      authMode: "auto",
      actionUriEnabled: false,
      timeoutSecs: 15,
    });
  });

  it("exposes every search descriptor field in the rendered markup", () => {
    const { container } = render(
      <Harness initial={{ protocol: "voip-phone", isGroup: false }} />,
    );
    const fields: ConnectionEditorSearchFieldDescriptor[] =
      CONNECTION_EDITOR_SEARCH_DESCRIPTORS.flatMap(
        (descriptor): readonly ConnectionEditorSearchFieldDescriptor[] =>
          descriptor.fields ?? [],
      ).filter((field) => field.protocols?.includes("voip-phone"));
    expect(fields.map((field) => field.id).sort()).toEqual([
      "voip-phone-action-uri",
      "voip-phone-auth-mode",
      "voip-phone-tls",
      "voip-phone-vendor",
    ]);
    for (const field of fields) {
      expect(
        container.querySelector(`[data-editor-search-field="${field.id}"]`),
        field.id,
      ).not.toBeNull();
      for (const path of field.valuePaths ?? []) {
        expect(path.startsWith("voipPhoneSettings."), path).toBe(true);
      }
    }
  });
});
