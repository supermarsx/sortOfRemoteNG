import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_OPTIONS,
  INTEGRATION_PROTOCOL_OPTIONS,
} from "../../src/hooks/connection/useConnectionEditor";
import {
  PROTOCOL_ICON_DEFAULTS,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { integrationRegistry } from "../../src/types/integrations/registry";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import {
  microsoftexchange,
  microsoftexchangemodern,
} from "../../src/utils/icons/brand";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === "string" ? fallback : (fallback?.defaultValue ?? key),
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  }),
}));
vi.mock("../../src/components/connection/TagManager", () => ({
  TagManager: () => <div />,
}));
// Model the installed full desktop build, not JSDOM's absent native backend.
// The protocol list, resolver, picker, and all icon components remain real.
vi.mock("../../src/hooks/runtime/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    source: "native",
    cloud: true,
    ops: true,
    rdp: true,
    serial: true,
    mysql: true,
    postgresql: true,
    mongodb: true,
  }),
}));

function geometry(svg: Element) {
  const clone = svg.cloneNode(true) as Element;
  for (const node of Array.from(clone.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return clone.innerHTML;
}
function expectedGeometry(key: string) {
  const definition = getConnectionIconDefinition(key);
  expect(definition, key).toBeDefined();
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(createElement(definition!.icon));
  return geometry(container.querySelector("svg")!);
}

describe("protocol-native icon wiring", () => {
  it("uses the modern Exchange identity for the plain mark and saved server inset", () => {
    expect(getConnectionIconDefinition("exchange")!.icon).toBe(
      microsoftexchangemodern,
    );
    const modern = document.createElement("div");
    modern.innerHTML = renderToStaticMarkup(
      createElement(microsoftexchangemodern),
    );
    const legacy = document.createElement("div");
    legacy.innerHTML = renderToStaticMarkup(createElement(microsoftexchange));
    const modernGeometry = geometry(modern.querySelector("svg")!);
    expect(modernGeometry).not.toBe(geometry(legacy.querySelector("svg")!));
    expect(expectedGeometry("exchange")).toBe(modernGeometry);
    const server = document.createElement("div");
    server.innerHTML = renderToStaticMarkup(
      createElement(getConnectionIconDefinition("exchange-server")!.icon),
    );
    expect(server.querySelector('[data-role-frame="server"]')).not.toBeNull();
    expect(geometry(server.querySelector("svg svg")!)).toBe(modernGeometry);
  });

  it("covers the entire built-in selection list with canonical catalog icons", () => {
    expect(PROTOCOL_OPTIONS).toHaveLength(37);
    expect(PROTOCOL_OPTIONS.map((option) => option.value).sort()).toEqual(
      Object.keys(PROTOCOL_ICON_DEFAULTS).sort(),
    );
    for (const option of PROTOCOL_OPTIONS) {
      const key =
        PROTOCOL_ICON_DEFAULTS[
          option.value as keyof typeof PROTOCOL_ICON_DEFAULTS
        ];
      expect(option.icon, option.value).toBe(
        getConnectionIconDefinition(key)?.icon,
      );
      expect(
        resolveEffectiveConnectionIcon({ protocol: option.value }),
        option.value,
      ).toMatchObject({ key, source: "protocol" });
    }
  });

  it.each([
    ["rdp", "microsoft"],
    ["ssh", "ssh"],
    ["nx", "nomachine"],
    ["ard", "apple"],
    ["serial", "serial"],
    ["vnc", "vnc"],
    ["https", "https"],
    ["idrac", "dell"],
    ["ilo", "hpe"],
    ["lenovo", "lenovo"],
    ["supermicro", "supermicro"],
  ])(
    "uses %s native choice %s while keeping explicit saved icons authoritative",
    (protocol, key) => {
      expect(expectedGeometry(key)).not.toBe("");
      expect(resolveEffectiveConnectionIcon({ protocol })).toMatchObject({
        key,
        source: "protocol",
      });
      for (const icon of ["monitor", "terminal", "eye", "cloud", "folder"]) {
        expect(
          resolveEffectiveConnectionIcon({ protocol, icon }),
        ).toMatchObject({ key: icon, source: "override" });
      }
      expect(
        resolveEffectiveConnectionIcon({ protocol, isGroup: true }),
      ).toMatchObject({ key: "folder", source: "folder" });
    },
  );

  it("uses descriptor canonical icons in actual integration selection options", () => {
    expect(INTEGRATION_PROTOCOL_OPTIONS.length).toBe(
      integrationRegistry.length,
    );
    for (const descriptor of integrationRegistry) {
      const option = INTEGRATION_PROTOCOL_OPTIONS.find(
        (candidate) => candidate.value === `integration:${descriptor.key}`,
      );
      expect(option, descriptor.key).toBeDefined();
      expect(option!.icon, descriptor.key).toBe(
        getConnectionIconDefinition(descriptor.defaultConnectionIconKey)?.icon,
      );
    }
  });

  it.each([
    ["lxd", "lxd"],
    ["pfsense", "pfsense"],
    ["netbox", "netbox"],
    ["vmwareDesktop", "vmware"],
    ["vmware", "vmware"],
    ["cpanel", "cpanel"],
    ["ansible", "ansible"],
    ["draytek", "draytek"],
    ["proxmox", "proxmox"],
    ["portainer", "portainer"],
    ["nginx", "nginx"],
    ["haproxy", "haproxy"],
    ["caddy", "caddy"],
    ["traefik", "traefikproxy"],
    ["php", "php"],
    ["nginxProxyMgr", "nginx-proxy-manager"],
    ["mssql", "mssql"],
    ["prometheus", "prometheus"],
    ["gdrive", "google-drive"],
    ["grafana", "grafana"],
    ["budibase", "budibase"],
    ["jira", "jira"],
    ["osticket", "osticket"],
    ["mailcow", "mailcow"],
    ["exchange", "exchange"],
    ["mail", "mail"],
    ["keepass", "keepass"],
  ])("uses integration %s native icon %s", (integration, key) => {
    const descriptor = integrationRegistry.find(
      (entry) => entry.key === integration,
    );
    expect(descriptor, integration).toBeDefined();
    expect(descriptor!.defaultConnectionIconKey).toBe(key);
    expect(descriptor!.icon).toBe(getConnectionIconDefinition(key)?.icon);
    expect(
      resolveEffectiveConnectionIcon(
        {
          protocol: `integration:${integration}`,
          integration: { descriptorKey: integration },
        },
        descriptor,
      ),
    ).toMatchObject({ key, source: "integration" });
  });

  it.each([
    ["rdp", /RDP/, "microsoft"],
    ["exchange", /Exchange/, "exchange"],
  ])(
    "renders and selects the plain %s icon in the real editor dropdown",
    async (query, name, key) => {
      render(
        <ConnectionProvider>
          <ConnectionEditor isOpen onClose={vi.fn()} />
        </ConnectionProvider>,
      );
      await act(async () => {
        await Promise.resolve();
      });
      const trigger = screen.getByTestId("editor-protocol");
      fireEvent.click(trigger);
      fireEvent.change(screen.getByTestId("editor-protocol-search"), {
        target: { value: query },
      });
      const option = screen.getByRole("option", { name });
      expect(geometry(option.querySelector("svg")!)).toBe(
        expectedGeometry(key),
      );
      fireEvent.click(option);
      expect(geometry(trigger.querySelector("svg")!)).toBe(
        expectedGeometry(key),
      );
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    },
  );

  it("renders all 37 built-in and 27 integration defaults without appliance wrappers", () => {
    expect(PROTOCOL_OPTIONS).toHaveLength(37);
    expect(integrationRegistry).toHaveLength(27);
    const options = [...PROTOCOL_OPTIONS, ...INTEGRATION_PROTOCOL_OPTIONS];
    for (const option of options) {
      const descriptor = integrationRegistry.find(
        (entry) => option.value === `integration:${entry.key}`,
      );
      const resolved = resolveEffectiveConnectionIcon(
        { protocol: option.value },
        descriptor,
      );
      for (const Icon of [option.icon, resolved.icon, descriptor?.icon].filter(
        Boolean,
      )) {
        const markup = renderToStaticMarkup(createElement(Icon!));
        expect(markup, option.value).not.toMatch(
          /data-role-frame|sor-role-icon-/,
        );
        const container = document.createElement("div");
        container.innerHTML = markup;
        expect(container.querySelector("svg svg"), option.value).toBeNull();
        expect(
          container.querySelector(
            "path,rect,circle,line,polyline,polygon,ellipse",
          ),
          option.value,
        ).not.toBeNull();
      }
    }
  });

  it.each([
    ["rdp", "microsoft-rdp"],
    ["ard", "apple-rd"],
    ["ibm-csp", "ibm-cloud"],
    ["idrac", "dell-idrac"],
    ["ilo", "ilo"],
    ["lenovo", "lenovo-xclarity"],
    ["supermicro", "supermicro-bmc"],
    ["integration:vmwareDesktop", "vmware-workstation"],
    ["integration:vmware", "vsphere"],
  ])(
    "preserves explicitly saved %s appliance override %s",
    (protocol, icon) => {
      const stored = JSON.parse(JSON.stringify({ protocol, icon }));
      const descriptor = integrationRegistry.find(
        (entry) => protocol === `integration:${entry.key}`,
      );
      const resolved = resolveEffectiveConnectionIcon(stored, descriptor);
      expect(resolved).toMatchObject({ key: icon, source: "override" });
      expect(renderToStaticMarkup(createElement(resolved.icon))).toContain(
        "data-role-frame=",
      );
    },
  );
});
