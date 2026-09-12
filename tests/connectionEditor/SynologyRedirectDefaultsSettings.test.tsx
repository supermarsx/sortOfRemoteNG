import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { useHTTPOptions } from "../../src/hooks/connection/useHTTPOptions";
import ProxyPolicySection from "../../src/components/connectionEditor/httpOptions/ProxyPolicySection";

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));

afterEach(cleanup);
function Fixture({ seed = {} }: { seed?: Partial<Connection> }) {
  const [formData, setFormData] = useState<Partial<Connection>>({
    protocol: "https",
    hostname: "my-nas.fr3.quickconnect.to",
    port: 443,
    ...seed,
  });
  const mgr = useHTTPOptions(formData, setFormData);
  return (
    <>
      <ProxyPolicySection mgr={mgr} />
      <output data-testid="draft">{JSON.stringify(formData)}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent!);
const checkbox = () =>
  screen.getByRole("checkbox", {
    name: /^Use Synology default redirect destinations/,
  });

describe("Synology default redirect controls", () => {
  it("shows exact derived defaults without writing draft trust, policy or credentials", () => {
    render(<Fixture />);
    expect(checkbox()).toBeChecked();
    expect(checkbox()).toHaveAccessibleName(
      /initial discovery through the app proxy at https:\/\/global\.quickconnect\.to\/Serv\.php/,
    );
    expect(
      screen.getByText(
        /Only the initial get_server_info discovery POST is included/,
      ),
    ).toBeInTheDocument();
    const list = screen.getByRole("list", {
      name: "Synology default redirect destinations",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(list).toHaveTextContent("http://my-nas.quickconnect.to");
    expect(list).not.toHaveTextContent("http://my-nas.fr3.quickconnect.to");
    expect(draft()).not.toHaveProperty("synologySettings");
    expect(draft()).not.toHaveProperty("httpTrustedRedirectDestinations");
    expect(draft()).not.toHaveProperty("httpProxyPolicy");
  });
  it("persists opt-out across remount while retaining explicit trust and stronger controls", () => {
    const trust = {
      version: 1 as const,
      origins: ["http://my-nas.quickconnect.to"],
    };
    const policy = { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true };
    const view = render(
      <Fixture
        seed={{
          httpTrustedRedirectDestinations: trust,
          httpProxyPolicy: policy,
        }}
      />,
    );
    expect(
      screen.getByText("Blocked by Require HTTPS upstream"),
    ).toBeInTheDocument();
    fireEvent.click(checkbox());
    const saved = draft();
    expect(saved.synologySettings.useDefaultRedirectDestinations).toBe(false);
    expect(saved.httpTrustedRedirectDestinations).toEqual(trust);
    expect(saved.httpProxyPolicy).toEqual(policy);
    expect(saved).not.toHaveProperty("httpRedirectAuthentication");
    expect(JSON.stringify(saved)).not.toContain("synologyQuickConnectDefaults");
    view.unmount();
    render(<Fixture seed={saved} />);
    expect(checkbox()).not.toBeChecked();
    expect(
      screen.getByRole("list", { name: "Trusted redirect destination list" }),
    ).toHaveTextContent(trust.origins[0]);
    fireEvent.click(checkbox());
    expect(draft().synologySettings.useDefaultRedirectDestinations).toBe(true);
  });
  it("shows only the two portals for custom DSM and deep QuickConnect sources", () => {
    const view = render(
      <Fixture
        seed={{
          hostname: "nas.internal",
          port: 5001,
          httpApplication: {
            version: 1,
            id: "synology-dsm",
            loginMode: "manual",
          },
        }}
      />,
    );
    expect(
      within(
        screen.getByRole("list", {
          name: "Synology default redirect destinations",
        }),
      ).getAllByRole("listitem"),
    ).toHaveLength(2);
    view.unmount();
    render(<Fixture seed={{ hostname: "nas.id.direct.quickconnect.to" }} />);
    expect(
      within(
        screen.getByRole("list", {
          name: "Synology default redirect destinations",
        }),
      ).getAllByRole("listitem"),
    ).toHaveLength(2);
  });
  it.each([
    { hostname: "generic.example" },
    { protocol: "synology" as const },
    {
      httpApplication: {
        version: 1 as const,
        id: "synology-dsm" as const,
        loginMode: "manual" as const,
      },
      synologySettings: {
        version: 1 as const,
        useHttps: true,
        accessMode: "native" as const,
      },
    },
  ])(
    "does not expose website defaults for an unrelated or native view",
    (seed) => {
      render(<Fixture seed={seed} />);
      expect(
        screen.queryByRole("checkbox", {
          name: /^Use Synology default redirect destinations/,
        }),
      ).not.toBeInTheDocument();
    },
  );
});
