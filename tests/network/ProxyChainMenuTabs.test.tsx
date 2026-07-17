import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type {
  SavedProxyChain,
  SavedTunnelChain,
  SavedTunnelProfile,
} from "../../src/types/settings/vpnSettings";

// ── Shared mutable test state ─────────────────────────────────────
//
// `vi.hoisted` because the vi.mock factories below run before this
// module's body executes, so anything they close over must be hoisted
// with them.

const h = vi.hoisted(() => {
  const self = {
    // Flipped per-describe. The wiring block stubs the child tabs (making
    // those tests about *wiring*, not about tab internals); the data block
    // renders the real ones, which is the only way to prove the three
    // chain tabs read genuinely different collections.
    useRealChildren: false,
    dispatch: vi.fn(),
    store: {
      profiles: [] as unknown[],
      chains: [] as unknown[],
      tunnelChains: [] as unknown[],
      tunnelProfiles: [] as unknown[],
    },
    // vi.mock() needs a literal path, so the factory is built here and
    // applied per module below.
    tabMock:
      (name: string) =>
      async (
        importOriginal: () => Promise<{
          default: (props: Record<string, unknown>) => unknown;
        }>,
      ) => {
        const actual = await importOriginal();
        const ReactMod = await import("react");
        return {
          default: (props: Record<string, unknown>) =>
            self.useRealChildren
              ? ReactMod.createElement(actual.default as never, props)
              : ReactMod.createElement(
                  "div",
                  { "data-testid": `stub-${name}` },
                  name,
                ),
        };
      },
  };
  return self;
});

// ── Mocks ─────────────────────────────────────────────────────────

// The global setup resolves every `invoke` with `undefined`, which makes
// ProxyOpenVPNManager.listConnectionChains() throw on `results.map` —
// reloadChains() would then swallow it and never seed savedChains, leaving
// the Chains tab silently empty. Return real arrays instead.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "list_connection_chains") return [];
    if (cmd === "list_proxy_chains") return [];
    return undefined;
  }),
  isTauri: vi.fn().mockReturnValue(false),
  transformCallback: vi.fn(),
  Channel: vi.fn(),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections: [] }, dispatch: h.dispatch }),
}));

vi.mock("../../src/utils/connection/proxyCollectionManager", () => {
  const byName = <T extends { name: string }>(rows: T[], query: string) =>
    rows.filter((row) =>
      row.name.toLowerCase().includes(query.trim().toLowerCase()),
    );
  return {
    proxyCollectionManager: {
      subscribe: () => () => {},
      getProfiles: () => h.store.profiles,
      getChains: () => h.store.chains,
      getChain: (id: string) =>
        (h.store.chains as SavedProxyChain[]).find((c) => c.id === id),
      getTunnelChains: () => h.store.tunnelChains,
      getTunnelChain: (id: string) =>
        (h.store.tunnelChains as SavedTunnelChain[]).find((c) => c.id === id),
      getTunnelProfiles: () => h.store.tunnelProfiles,
      searchProfiles: (q: string) =>
        byName(h.store.profiles as { name: string }[], q),
      searchChains: (q: string) =>
        byName(h.store.chains as SavedProxyChain[], q),
      searchTunnelChains: (q: string) =>
        byName(h.store.tunnelChains as SavedTunnelChain[], q),
      searchTunnelProfiles: (q: string) =>
        byName(h.store.tunnelProfiles as SavedTunnelProfile[], q),
    },
  };
});

// Each child tab renders a marker div, or delegates to the real component
// when h.useRealChildren is set.
vi.mock(
  "../../src/components/network/proxyChainMenu/ProfilesTab",
  h.tabMock("ProfilesTab"),
);
vi.mock(
  "../../src/components/network/proxyChainMenu/ChainsTab",
  h.tabMock("ChainsTab"),
);
vi.mock(
  "../../src/components/network/proxyChainMenu/UnifiedChainsTab",
  h.tabMock("UnifiedChainsTab"),
);
vi.mock(
  "../../src/components/network/proxyChainMenu/TunnelChainTab",
  h.tabMock("TunnelChainTab"),
);
vi.mock(
  "../../src/components/network/proxyChainMenu/LayerProfilesTab",
  h.tabMock("LayerProfilesTab"),
);
vi.mock(
  "../../src/components/network/proxyChainMenu/TunnelsTab",
  h.tabMock("TunnelsTab"),
);
vi.mock(
  "../../src/components/network/proxyChainMenu/VpnConnectionsTab",
  h.tabMock("VpnConnectionsTab"),
);
vi.mock(
  "../../src/components/network/proxyChainMenu/AssociationsTab",
  h.tabMock("AssociationsTab"),
);

import { ProxyChainMenu } from "../../src/components/network/ProxyChainMenu";

// ── i18next ───────────────────────────────────────────────────────
//
// react-i18next is deliberately NOT mocked. The repo's usual
// `t: (key, fallback) => fallback ?? key` stub returns count-bearing
// strings verbatim ("{{count}} layer"), because it does not interpolate.
// Real i18next with empty resources resolves each `t(key, "English")` to
// its English default AND interpolates, so the rendered text matches the
// running app in English.
await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

// ── Fixtures ──────────────────────────────────────────────────────

const TAB_IDS = [
  "profiles",
  "chains",
  "unifiedChains",
  "tunnelChains",
  "layerProfiles",
  "tunnels",
  "vpnConnections",
  "associations",
] as const;

// Verbatim from the frozen contract (t50 plan §3), in contract order.
const TAB_LABELS = [
  "Profiles",
  "Chains",
  "Unified Chains",
  "Tunnel Chains",
  "Layer Profiles",
  "SSH Tunnels",
  "VPN Connections",
  "Associations",
];

const legacyChain = (id: string, name: string): SavedProxyChain => ({
  id,
  name,
  layers: [{ position: 0, type: "proxy" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const tunnelChain = (
  id: string,
  name: string,
  layerType: SavedTunnelChain["layers"][number]["type"] = "proxy",
): SavedTunnelChain => ({
  id,
  name,
  layers: [{ id: `${id}-l0`, type: layerType, enabled: true }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const tunnelProfile = (id: string, name: string): SavedTunnelProfile => ({
  id,
  name,
  type: "proxy",
  config: { id: `${id}-cfg`, type: "proxy", enabled: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const tabButton = (id: string) =>
  screen.getByTestId(`proxy-chain-menu-tab-${id}`);

const renderMenu = async () => {
  const utils = render(<ProxyChainMenu isOpen onClose={() => {}} />);
  // reloadChains() runs in an effect; flush it so savedChains is seeded.
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
};

const openTab = async (id: string) => {
  fireEvent.click(tabButton(id));
  await waitFor(() =>
    expect(tabButton(id)).toHaveAttribute("aria-selected", "true"),
  );
};

beforeEach(() => {
  h.dispatch.mockClear();
  h.store.profiles = [];
  h.store.chains = [];
  h.store.tunnelChains = [];
  h.store.tunnelProfiles = [];
});

afterEach(() => {
  cleanup();
});

// ══════════════════════════════════════════════════════════════════
// Wiring — child tabs stubbed, so these assert on the sidebar↔panel
// wiring rather than on any tab's internals.
// ══════════════════════════════════════════════════════════════════

describe("ProxyChainMenu — tab wiring", () => {
  beforeEach(() => {
    h.useRealChildren = false;
  });

  it("renders all 8 tabs in contract order", async () => {
    await renderMenu();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(8);
    expect(tabs.map((tab) => tab.textContent)).toEqual(TAB_LABELS);
  });

  it("is a vertical tablist with exactly one selected tab", async () => {
    await renderMenu();
    const tablist = screen.getByRole("tablist");
    expect(tablist).toHaveAttribute("aria-orientation", "vertical");

    const selected = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(tabButton("profiles"));
  });

  it("roves tabIndex: the active tab is the list's only tab stop", async () => {
    await renderMenu();
    const stops = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(tabButton("profiles"));

    await openTab("tunnelChains");

    const movedStops = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") === "0");
    expect(movedStops).toHaveLength(1);
    expect(movedStops[0]).toBe(tabButton("tunnelChains"));
  });

  // The bug this whole task exists to fix: `chains` used to render
  // UnifiedChainsTab, which buried data.chains. Both directions are
  // asserted with the same selectors, so neither absence can pass
  // vacuously — each selector is proven to match in its own tab first.
  it("renders ChainsTab — not UnifiedChainsTab — on the chains tab", async () => {
    await renderMenu();
    await openTab("chains");
    expect(screen.getByTestId("stub-ChainsTab")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-UnifiedChainsTab")).toBeNull();
  });

  it("renders UnifiedChainsTab — not ChainsTab — on the unifiedChains tab", async () => {
    await renderMenu();
    await openTab("unifiedChains");
    expect(screen.getByTestId("stub-UnifiedChainsTab")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-ChainsTab")).toBeNull();
  });

  it.each([
    ["profiles", "ProfilesTab"],
    ["tunnelChains", "TunnelChainTab"],
    ["layerProfiles", "LayerProfilesTab"],
    ["tunnels", "TunnelsTab"],
    ["vpnConnections", "VpnConnectionsTab"],
    ["associations", "AssociationsTab"],
  ])("renders %s → %s", async (id, component) => {
    await renderMenu();
    await openTab(id);
    expect(screen.getByTestId(`stub-${component}`)).toBeInTheDocument();
  });

  it.each(TAB_IDS)(
    "closes the ARIA round-trip for the %s panel",
    async (id) => {
      await renderMenu();
      await openTab(id);

      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute("id", `proxy-chain-menu-panel-${id}`);

      const labelledBy = panel.getAttribute("aria-labelledby");
      expect(labelledBy).toBe(`proxy-chain-menu-tab-${id}`);

      // The label must resolve to a real element, and that element must be
      // the selected tab — otherwise the id convention is cosmetic.
      const label = document.getElementById(labelledBy!);
      expect(label).not.toBeNull();
      expect(label).toBe(tabButton(id));
      expect(label).toHaveAttribute("aria-selected", "true");
      expect(label).toHaveAttribute(
        "aria-controls",
        `proxy-chain-menu-panel-${id}`,
      );
    },
  );

  it("activates a tab on click", async () => {
    await renderMenu();
    fireEvent.click(tabButton("layerProfiles"));

    await waitFor(() =>
      expect(screen.getByTestId("stub-LayerProfilesTab")).toBeInTheDocument(),
    );
    expect(tabButton("layerProfiles")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "proxy-chain-menu-panel-layerProfiles",
    );
  });

  it("ArrowDown moves Profiles → Chains", async () => {
    await renderMenu();
    const profiles = tabButton("profiles");
    profiles.focus();
    fireEvent.keyDown(profiles, { key: "ArrowDown" });

    await waitFor(() =>
      expect(tabButton("chains")).toHaveAttribute("aria-selected", "true"),
    );
    expect(document.activeElement).toBe(tabButton("chains"));
    expect(screen.getByTestId("stub-ChainsTab")).toBeInTheDocument();
  });

  it("ArrowUp from Profiles wraps to Associations", async () => {
    await renderMenu();
    const profiles = tabButton("profiles");
    profiles.focus();
    fireEvent.keyDown(profiles, { key: "ArrowUp" });

    await waitFor(() =>
      expect(tabButton("associations")).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(document.activeElement).toBe(tabButton("associations"));
    expect(screen.getByTestId("stub-AssociationsTab")).toBeInTheDocument();
  });

  it("End jumps to Associations and Home returns to Profiles", async () => {
    await renderMenu();
    const profiles = tabButton("profiles");
    profiles.focus();
    fireEvent.keyDown(profiles, { key: "End" });

    await waitFor(() =>
      expect(document.activeElement).toBe(tabButton("associations")),
    );

    fireEvent.keyDown(tabButton("associations"), { key: "Home" });
    await waitFor(() =>
      expect(document.activeElement).toBe(tabButton("profiles")),
    );
    expect(tabButton("profiles")).toHaveAttribute("aria-selected", "true");
  });
});

// ══════════════════════════════════════════════════════════════════
// Data — the real child tabs, against real hooks. This is the block
// that proves the 8-tab split is backed by distinct collections.
// ══════════════════════════════════════════════════════════════════

describe("ProxyChainMenu — real tabs over real collections", () => {
  const CHAIN_A = "ALPHA-legacy-proxy-chain";
  const CHAIN_B = "BRAVO-tunnel-chain";

  beforeEach(() => {
    h.useRealChildren = true;
    h.store.chains = [legacyChain("chain-a", CHAIN_A)];
    h.store.tunnelChains = [tunnelChain("chain-b", CHAIN_B)];
  });

  // THE HEADLINE. `data.chains` (SavedProxyChain) and `data.tunnelChains`
  // (SavedTunnelChain) are different types with separate CRUD; an earlier
  // plan revision claimed these tabs would render identical content and
  // recommended collapsing them. These three tests are the disproof.
  it("Chains shows the legacy proxy chain and not the tunnel chain", async () => {
    await renderMenu();
    await openTab("chains");

    expect(await screen.findByText(CHAIN_A)).toBeInTheDocument();
    expect(screen.queryByText(CHAIN_B)).toBeNull();
  });

  it("Tunnel Chains shows the tunnel chain and not the legacy proxy chain", async () => {
    await renderMenu();
    await openTab("tunnelChains");

    expect(await screen.findByText(CHAIN_B)).toBeInTheDocument();
    expect(screen.queryByText(CHAIN_A)).toBeNull();
  });

  it("Unified Chains shows both — it is the union view", async () => {
    await renderMenu();
    await openTab("unifiedChains");

    expect(await screen.findByText(CHAIN_A)).toBeInTheDocument();
    expect(screen.getByText(CHAIN_B)).toBeInTheDocument();
  });

  it("Layer Profiles lists the tunnel profiles, which no chain tab shows", async () => {
    h.store.tunnelProfiles = [tunnelProfile("prof-1", "CHARLIE-layer-profile")];
    await renderMenu();

    await openTab("layerProfiles");
    expect(
      await screen.findByText("CHARLIE-layer-profile"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Layer Profiles" }),
    ).toBeInTheDocument();

    // The section was lifted out of Unified Chains; neither chain tab may
    // still render it. Both selectors are proven above.
    await openTab("unifiedChains");
    expect(screen.queryByText("CHARLIE-layer-profile")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Layer Profiles" }),
    ).toBeNull();

    await openTab("chains");
    expect(screen.queryByText("CHARLIE-layer-profile")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Layer Profiles" }),
    ).toBeNull();
  });

  it("renders the layer count through real i18next interpolation", async () => {
    await renderMenu();
    await openTab("chains");
    // Guards the {{count}} trap: the repo's usual non-interpolating `t`
    // stub would render "{{count}} layer" here.
    expect(await screen.findByText("1 layer")).toBeInTheDocument();
  });

  // B3 — the anti-drift test. UnifiedChainsTab had lost the Connect guard;
  // both tabs now render the shared TunnelChainRow, which resolves the
  // guard itself.
  describe("Connect guard (B3)", () => {
    const BLOCKED = "DELTA-ssh-jump-chain";

    beforeEach(() => {
      h.store.tunnelChains = [
        tunnelChain("chain-ssh", BLOCKED, "ssh-jump"),
        tunnelChain("chain-proxy", "ECHO-proxy-chain", "proxy"),
      ];
    });

    it.each(["tunnelChains", "unifiedChains"])(
      "disables Connect with the reason as title on the %s tab",
      async (tab) => {
        await renderMenu();
        await openTab(tab);

        const blockedRow = (await screen.findByText(BLOCKED)).closest(
          ".sor-selection-row",
        )!;
        // Exact name: /connect/i would also match "Disconnect".
        const connect = within(blockedRow as HTMLElement).getByRole("button", {
          name: "Connect",
        });
        expect(connect).toBeDisabled();
        expect(connect.getAttribute("title")).toMatch(
          /Ad-hoc Connect is not available/i,
        );

        // Prove the selector is not simply matching a disabled button
        // everywhere: the proxy-layer chain's Connect is live.
        const okRow = screen
          .getByText("ECHO-proxy-chain")
          .closest(".sor-selection-row")!;
        const okConnect = within(okRow as HTMLElement).getByRole("button", {
          name: "Connect",
        });
        expect(okConnect).toBeEnabled();
        expect(okConnect).toHaveAttribute("title", "Connect chain");
      },
    );
  });

  // B2 — Unified Chains unions two collections, so its single search box
  // must drive both searches or half the list silently ignores it.
  it("Unified Chains' search filters both collections", async () => {
    await renderMenu();
    await openTab("unifiedChains");

    expect(await screen.findByText(CHAIN_A)).toBeInTheDocument();
    expect(screen.getByText(CHAIN_B)).toBeInTheDocument();

    const search = screen.getByPlaceholderText("Search chains...");
    fireEvent.change(search, { target: { value: "BRAVO" } });

    // The tunnel chain survives the filter; the legacy chain is filtered
    // out — which only happens if mgr.setChainSearch was driven too.
    await waitFor(() => expect(screen.queryByText(CHAIN_A)).toBeNull());
    expect(screen.getByText(CHAIN_B)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "ALPHA" } });
    await waitFor(() => expect(screen.queryByText(CHAIN_B)).toBeNull());
    expect(screen.getByText(CHAIN_A)).toBeInTheDocument();
  });

  // B1 — legacy chain Edit was a dead end; it now opens a proxyChainEditor
  // tool session carrying the chain id.
  it("Edit on a legacy chain opens a proxyChainEditor session for that chain", async () => {
    await renderMenu();
    await openTab("chains");

    const row = (await screen.findByText(CHAIN_A)).closest(
      ".sor-selection-row",
    )!;
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Edit" }),
    );

    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_SESSION",
        payload: expect.objectContaining({
          protocol: "tool:proxyChainEditor",
          connectionId: "chain-a",
        }),
      }),
    );
  });
});
