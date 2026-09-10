import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import { useHTTPOptions } from "../../src/hooks/connection/useHTTPOptions";
import ProxyPolicySection from "../../src/components/connectionEditor/httpOptions/ProxyPolicySection";
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

describe("Internal proxy controls", () => {
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
  });
});
