import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import { useHTTPOptions } from "../../src/hooks/connection/useHTTPOptions";
import ProxyPolicySection from "../../src/components/connectionEditor/httpOptions/ProxyPolicySection";
import {
  DEFAULT_HTTP_PROXY_POLICY,
  DEFAULT_EXTERNAL_FONT_ORIGINS,
  DEFAULT_EXTERNAL_RESOURCE_ORIGINS,
} from "../../src/types/connection/httpProxyPolicy";
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));

function Fixture({
  initial = { protocol: "http" },
}: {
  initial?: Partial<Connection>;
}) {
  const [formData, setFormData] = useState(initial);
  const mgr = useHTTPOptions(formData, setFormData);
  return (
    <>
      <ProxyPolicySection mgr={mgr} />
      <output data-testid="draft">{JSON.stringify(formData)}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent!);
const fontOptOut = (): Partial<Connection> => ({
  protocol: "http",
  httpProxyPolicy: {
    ...DEFAULT_HTTP_PROXY_POLICY,
    allowExternalFonts: false,
    externalFontOrigins: [],
  },
});

describe("Internal proxy controls", () => {
  it("shows common defaults for absent policies without saving a policy on render", () => {
    render(<Fixture />);
    expect(
      screen.getByRole("checkbox", {
        name: /Load external fonts through proxy/,
      }),
    ).toBeChecked();
    for (const origin of DEFAULT_EXTERNAL_FONT_ORIGINS)
      expect(
        screen.getByRole("button", { name: `Remove font origin ${origin}` }),
      ).toBeVisible();
    for (const row of DEFAULT_EXTERNAL_RESOURCE_ORIGINS)
      expect(
        screen.getByRole("button", {
          name: `Remove resource origin ${row.origin}`,
        }),
      ).toBeVisible();
    expect(draft().httpProxyPolicy).toBeUndefined();
  });

  it("saves exact resource kinds, preserves empty font opt-outs and other policy fields, and reopens the draft", () => {
    const initial: Partial<Connection> = {
      ...fontOptOut(),
      httpProxyPolicy: {
        ...fontOptOut().httpProxyPolicy!,
        externalResourceOrigins: [],
        queryParameters: [{ name: "tenant", value: "synthetic" }],
      },
    };
    const view = render(<Fixture initial={initial} />);
    expect(draft()).toEqual(initial);
    expect(
      screen.queryByRole("list", { name: "Saved external resource origins" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("External resource origin"), {
      target: { value: "https://Assets.Example.test/" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Scripts" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Stylesheets" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add resource origin" }),
    );
    expect(draft().httpProxyPolicy).toMatchObject({
      externalResourceOrigins: [
        {
          origin: "https://assets.example.test",
          kinds: ["script", "stylesheet"],
        },
      ],
      allowExternalFonts: false,
      externalFontOrigins: [],
      queryParameters: [{ name: "tenant", value: "synthetic" }],
    });
    const saved = draft();
    view.unmount();
    render(<Fixture initial={saved} />);
    expect(draft()).toEqual(saved);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Same-origin resources and forms/ }),
    );
    expect(screen.getByLabelText("External resource origin")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Restore common resource defaults" }),
    ).toBeDisabled();
    expect(draft().httpProxyPolicy.externalResourceOrigins).toEqual(
      saved.httpProxyPolicy.externalResourceOrigins,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Same-origin resources and forms/ }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove resource origin https://assets.example.test",
      }),
    );
    expect(draft().httpProxyPolicy.externalResourceOrigins).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore common resource defaults" }),
    );
    expect(draft().httpProxyPolicy.externalResourceOrigins).toEqual(
      DEFAULT_EXTERNAL_RESOURCE_ORIGINS,
    );
    expect(draft().httpProxyPolicy.allowExternalFonts).toBe(false);
    expect(draft().httpProxyPolicy.externalFontOrigins).toEqual([]);
  });

  it("opts in to fonts, adds both Google destinations idempotently and reopens saved settings", () => {
    const view = render(<Fixture initial={fontOptOut()} />);
    const toggle = screen.getByRole("checkbox", {
      name: /Load external fonts through proxy/,
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText("External font origin")).toBeDisabled();
    expect(draft().httpProxyPolicy.allowExternalFonts).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Add Google Fonts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Google Fonts" }));
    expect(draft().httpProxyPolicy.externalFontOrigins).toEqual([
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ]);
    expect(
      screen.getByText(/No cookies or saved credentials/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Configure both font stylesheet and font binary/),
    ).toBeInTheDocument();
    const saved = draft();
    view.unmount();
    render(<Fixture initial={saved} />);
    expect(
      screen.getByRole("checkbox", {
        name: /Load external fonts through proxy/,
      }),
    ).toBeChecked();
    expect(draft().httpProxyPolicy).toEqual(saved.httpProxyPolicy);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove font origin https://fonts.gstatic.com",
      }),
    );
    expect(draft().httpProxyPolicy.externalFontOrigins).toEqual([
      "https://fonts.googleapis.com",
    ]);
  });
  it("keeps invalid and duplicate font drafts visible until corrected", () => {
    render(<Fixture initial={fontOptOut()} />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Load external fonts through proxy/,
      }),
    );
    const input = screen.getByLabelText("External font origin");
    const add = screen.getByRole("button", { name: "Add font origin" });
    fireEvent.change(input, {
      target: { value: "https://fonts.example.com/path" },
    });
    fireEvent.click(add);
    expect(input).toHaveValue("https://fonts.example.com/path");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "unique exact HTTPS origins",
    );
    expect(draft().httpProxyPolicy.externalFontOrigins).toEqual([]);
    fireEvent.change(input, {
      target: { value: " HTTPS://Fonts.Example.com:443/ " },
    });
    fireEvent.click(add);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(input, {
      target: { value: "https://fonts.example.com/" },
    });
    fireEvent.click(add);
    expect(input).toHaveValue("https://fonts.example.com/");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Duplicate origins are rejected",
    );
    expect(draft().httpProxyPolicy.externalFontOrigins).toEqual([
      "https://fonts.example.com",
    ]);
  });
  it("disables effective font controls under same-origin restrictions and preserves drafts", () => {
    render(<Fixture initial={fontOptOut()} />);
    const fonts = screen.getByRole("checkbox", {
      name: /Load external fonts through proxy/,
    });
    fireEvent.click(fonts);
    fireEvent.click(screen.getByRole("button", { name: "Add Google Fonts" }));
    const input = screen.getByLabelText("External font origin");
    fireEvent.change(input, {
      target: { value: "https://pending.example.com" },
    });
    const sameOrigin = screen.getByRole("checkbox", {
      name: /Same-origin resources and forms/,
    });
    fireEvent.click(sameOrigin);
    expect(fonts).toBeDisabled();
    expect(fonts).not.toBeChecked();
    expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add Google Fonts" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add font origin" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Remove font origin https://fonts.gstatic.com",
      }),
    ).toBeDisabled();
    expect(screen.getByText(/overrides external fonts/)).toBeInTheDocument();
    expect(draft().httpProxyPolicy.allowExternalFonts).toBe(true);
    expect(draft().httpProxyPolicy.externalFontOrigins).toHaveLength(2);
    fireEvent.click(sameOrigin);
    expect(fonts).toBeChecked();
    expect(input).toBeEnabled();
    expect(input).toHaveValue("https://pending.example.com");
  });
  it("saves default-off redirect authentication separately and preserves it on remount", () => {
    const view = render(<Fixture initial={{ protocol: "https" }} />);
    const carry = screen.getByRole("checkbox", {
      name: /Carry saved login through reviewed redirects/,
    });
    expect(carry).not.toBeChecked();
    const insecure = screen.getByRole("checkbox", {
      name: /Allow saved login to be sent to unencrypted HTTP/,
    });
    expect(insecure).toBeDisabled();
    fireEvent.click(carry);
    expect(draft().httpRedirectAuthentication).toEqual({
      version: 1,
      mode: "saved-login",
      allowInsecureHttp: false,
    });
    fireEvent.click(insecure);
    const saved = JSON.parse(JSON.stringify(draft()));
    view.unmount();
    render(<Fixture initial={saved} />);
    expect(
      screen.getByRole("checkbox", {
        name: /Carry saved login through reviewed redirects/,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /Allow saved login to be sent to unencrypted HTTP/,
      }),
    ).toBeChecked();
  });
  it("offers default-off reviewed redirects without enabling or copying authentication", () => {
    render(<Fixture initial={{ protocol: "https" }} />);
    const control = screen.getByRole("checkbox", {
      name: /Allow reviewed cross-origin redirects/,
    });
    expect(control).not.toBeChecked();
    const downgrade = screen.getByRole("checkbox", {
      name: /Allow reviewed HTTPS-to-HTTP downgrades/,
    });
    expect(downgrade).not.toBeChecked();
    expect(downgrade).toBeDisabled();
    fireEvent.click(control);
    expect(downgrade).toBeEnabled();
    fireEvent.click(downgrade);
    expect(draft().httpProxyPolicy.allowHttpDowngradeRedirects).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Require HTTPS upstream/ }),
    );
    expect(downgrade).toBeDisabled();
    expect(draft().httpProxyPolicy.allowCrossOriginRedirects).toBe(true);
    expect(draft().httpAutoLogin).toBeUndefined();
    expect(draft().httpProxyPolicy.queryParameters).toEqual([]);
    fireEvent.click(control);
    expect(draft().httpProxyPolicy.allowCrossOriginRedirects).toBe(false);
  });
  it("does not silently change legacy drafts and makes HTTPS enforcement explicit", () => {
    render(<Fixture />);
    expect(draft().httpProxyPolicy).toBeUndefined();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Require HTTPS upstream/ }),
    );
    expect(draft().httpProxyPolicy.httpsOnly).toBe(true);
    expect(draft().protocol).toBe("http");
    expect(
      screen.getByText(/This connection currently uses HTTP/),
    ).toHaveAttribute("role", "status");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Same-origin resources and forms/ }),
    );
    expect(draft().httpProxyPolicy.sameOriginOnly).toBe(true);
  });
  it("masks extra parameter values, rejects duplicate keys, and removes only the chosen row", () => {
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText("Parameter name"), {
      target: { value: "tenant" },
    });
    fireEvent.change(screen.getByLabelText("Parameter value"), {
      target: { value: "synthetic-private-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(screen.getByLabelText("Value for tenant")).toHaveAttribute(
      "type",
      "password",
    );
    expect(draft().httpProxyPolicy.queryParameters).toEqual([
      { name: "tenant", value: "synthetic-private-value" },
    ]);
    fireEvent.change(screen.getByLabelText("Parameter name"), {
      target: { value: "tenant" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "unique parameter names",
    );
    expect(draft().httpProxyPolicy.queryParameters).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove tenant" }));
    expect(draft().httpProxyPolicy.queryParameters).toEqual([]);
  });
  it("requires an explicit reset for malformed imported restrictions", () => {
    render(
      <Fixture
        initial={{
          httpProxyPolicy: {
            version: 99,
          } as unknown as Connection["httpProxyPolicy"],
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("blocked");
    expect(draft().httpProxyPolicy.version).toBe(99);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset proxy controls" }),
    );
    expect(draft().httpProxyPolicy.version).toBe(1);
    expect(draft().httpProxyPolicy.externalFontOrigins).toEqual(
      DEFAULT_EXTERNAL_FONT_ORIGINS,
    );
    expect(draft().httpProxyPolicy.externalResourceOrigins).toEqual(
      DEFAULT_EXTERNAL_RESOURCE_ORIGINS,
    );
  });
});
