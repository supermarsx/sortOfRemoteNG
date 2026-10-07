import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { GoogleProxyRoute } from "../../src/utils/protocol/googleProxySession";
import { GOOGLE_SERVICE_PROFILES } from "../../src/utils/connection/googleServiceProfiles";
import {
  getReviewedApplicationProfile,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import {
  expectedGoogleOrigins,
  validateGoogleProxyRoutes,
} from "../../src/utils/protocol/googleProxySession";
import catalog from "../../src/utils/protocol/googleHostedRoutes.json";
import { certificateInfoFixture } from "../fixtures/certificateInspection";
import { clearRuntimeConnectionsForTests } from "../../src/utils/session/runtimeConnectionRegistry";

// Same transport/context fixture pattern as httpNetworkPathConsumers. The real
// registry, target resolution, login resolver and route validation remain active.
// Native responses are fixtures; no Rust execution or real account is asserted.
const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  resolveCredential: vi.fn(),
  connections: [] as Connection[],
  mutateRoutes: undefined as
    | ((routes: GoogleProxyRoute[]) => GoogleProxyRoute[] | undefined)
    | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: fixture.connections, sessions: [] },
    dispatch: fixture.dispatch,
    databaseAvailability: {
      status: "ready",
      databaseId: "google-owner",
      generation: 1,
    },
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: { httpsTrustPolicy: "tofu", httpsCaTrustMode: "system" },
    settingsReady: true,
  }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: () => () => {},
}));
vi.mock("../../src/hooks/security/useRuntimeCredentialVault", () => ({
  useRuntimeCredentialVault: () => fixture.resolveCredential,
}));
vi.mock("../../src/hooks/recording/useWebRecorder", () => ({
  useWebRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/hooks/recording/useDisplayRecorder", () => ({
  useDisplayRecorder: () => ({ state: {} }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: () => "http://proxy.example.test:3128/",
}));
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  verifyIdentity: vi.fn(async () => ({ status: "trusted" })),
}));

import { useHTTPViewer } from "../../src/hooks/protocol/useHTTPViewer";
import { useWebBrowser } from "../../src/hooks/protocol/useWebBrowser";

const proxyOrigin = "http://p0123456789abcdef0123456789abcdef.localhost:43081";
const credentials = {
  username: "google-fixture@example.test",
  password: "synthetic-google-password",
};
const entries = [
  ["youtube-studio", "https://studio.youtube.com/"],
  ["google-ad-manager", "https://admanager.google.com/"],
  ["google-adsense", "https://adsense.google.com/adsense/login"],
  ["google-forms", "https://docs.google.com/forms/"],
  ["google-gemini", "https://gemini.google.com/"],
  ["google-workspace-admin", "https://admin.google.com/"],
  ["google-play-store", "https://play.google.com/store/"],
  ["google-developers", "https://developers.google.com/"],
  ["google-play-console", "https://play.google.com/console/"],
] as const;

function nativeRoutes(source: string): GoogleProxyRoute[] {
  // Sorted like the native BTreeMap, intentionally independent of profile order.
  const scope: [string, boolean][] = [
    [source, true],
    ["https://accounts.google.com", true],
    ["https://www.google.com", true],
    ["https://www.gstatic.com", false],
    ["https://ssl.gstatic.com", false],
    ["https://fonts.gstatic.com", false],
    ["https://fonts.googleapis.com", false],
    ["https://apis.google.com", false],
  ];
  if (source === "https://studio.youtube.com") {
    scope.push(["https://www.youtube.com", true]);
  }
  return scope
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([upstreamOrigin, documents], index) => ({
      upstreamOrigin,
      documents,
      proxyOrigin:
        upstreamOrigin === source
          ? proxyOrigin
          : `http://p${(index + 10).toString(16).padStart(32, "0")}.localhost:43081`,
    }));
}

function configure(
  id: string,
  url: string,
  hostname: string,
  loginMode: "manual" | "form" = "manual",
) {
  const connection: Connection = {
    id: "google-service-connection",
    name: id,
    protocol: "https",
    hostname,
    port: 443,
    isGroup: false,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
    ...credentials,
    authType: "basic",
    httpAutoLogin: true, // Legacy opt-in must not override explicit manual mode.
    httpHeaders: { Authorization: "Bearer legacy-fixture" },
    httpApplication: { version: 1, id, loginMode },
  };
  fixture.connections = [connection];
  expect(getReviewedApplicationProfile(connection)).toBe("google-hosted");
  expect(() => validateHttpApplicationTarget(connection, url)).not.toThrow();
  return connection;
}

function session(): ConnectionSession {
  const connection = fixture.connections[0];
  return {
    id: "google-service-session",
    connectionId: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    hostname: connection.hostname,
    ownerDatabaseId: "google-owner",
    status: "connected",
    startTime: new Date("2026-10-06T00:00:00.000Z"),
  };
}

function BrowserHarness() {
  const activeSession = React.useMemo(session, []);
  const browser = useWebBrowser(activeSession);
  return (
    <>
      <output data-testid="google-target">{browser.currentUrl}</output>
      <output data-testid="google-error">
        {browser.loadError ? "blocked" : ""}
      </output>
      {browser.shouldMountIframe && (
        <iframe title="Google service" ref={browser.attachIframe} />
      )}
    </>
  );
}

function ViewerHarness() {
  const activeSession = React.useMemo(session, []);
  const viewer = useHTTPViewer(activeSession);
  return (
    <>
      <output data-testid="google-target">{viewer.currentUrl}</output>
      <output data-testid="google-error">
        {viewer.status === "error" ? "blocked" : ""}
      </output>
      {viewer.proxyUrl && (
        <iframe
          title="Google service"
          ref={viewer.iframeRef}
          src={viewer.proxyUrl}
        />
      )}
    </>
  );
}

const starts = () =>
  fixture.invoke.mock.calls.filter(
    ([command]) => command === "start_basic_auth_proxy",
  );

async function expectEntry(url: string) {
  const target = new URL(url);
  const account = nativeRoutes(target.origin).find(
    ({ upstreamOrigin }) => upstreamOrigin === "https://accounts.google.com",
  )!;
  await waitFor(() => {
    expect(screen.getByTestId("google-error")).toBeEmptyDOMElement();
    expect(screen.getByTestId("google-target").textContent).toBe(url);
    const entry = new URL(
      (screen.getByTitle("Google service") as HTMLIFrameElement).src,
    );
    expect(entry.origin).toBe(account.proxyOrigin);
    expect(entry.pathname).toBe("/ServiceLogin");
    expect(entry.searchParams.get("continue")).toBe(url);
    expect(entry.searchParams.get("followup")).toBe(url);
  });
}

beforeEach(() => {
  clearRuntimeConnectionsForTests();
  fixture.connections = [];
  fixture.mutateRoutes = undefined;
  fixture.dispatch.mockReset();
  fixture.resolveCredential.mockReset().mockResolvedValue(null);
  fixture.invoke
    .mockReset()
    .mockImplementation(
      async (command: string, args?: { config?: { target_url: string } }) => {
        if (command === "start_basic_auth_proxy") {
          const source = new URL(args!.config!.target_url).origin;
          if (!Object.values(catalog.profiles).includes(source))
            throw new Error("Unreviewed Google fixture origin");
          const routes = nativeRoutes(source);
          return {
            session_id: "google-service-native-fixture",
            local_port: 43081,
            proxy_url: proxyOrigin + "/",
            google_routes: fixture.mutateRoutes
              ? fixture.mutateRoutes(routes)
              : routes,
          };
        }
        if (command === "get_tls_certificate_info")
          return certificateInfoFixture;
        if (command === "web_network_guard_status")
          return {
            platform: "windows",
            frameNavigation: "enforced",
            allNetworkRequestsMediated: false,
          };
        if (command === "activate_proxy_network_document") return true;
        return undefined;
      },
    );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  clearRuntimeConnectionsForTests();
  vi.restoreAllMocks();
});

describe.each(["browser", "viewer"] as const)(
  "Google services in the %s hook",
  (runtime) => {
    const Harness = runtime === "browser" ? BrowserHarness : ViewerHarness;

    describe.each(entries)("%s", (id, url) => {
      it.each(["blank", "canonical"] as const)(
        "opens the full canonical entry from a %s saved host in manual mode",
        async (hostKind) => {
          const target = new URL(url);
          configure(id, url, hostKind === "blank" ? "" : target.hostname);
          render(<Harness />);
          await expectEntry(url);
          expect(starts()).toHaveLength(1);
          expect(starts()[0][1].config).toMatchObject({
            target_url: runtime === "browser" ? target.origin + "/" : url,
            reviewed_application_profile: "google-hosted",
            upstream_auth_mode: "none",
            username: "",
            password: "",
            http_auto_login: false,
            custom_headers: {},
            upstream_proxy_url: "http://proxy.example.test:3128/",
          });
          expect(
            starts()[0][1].config.http_auto_login_selectors,
          ).toBeUndefined();
          if (runtime === "browser")
            expect(fixture.invoke).toHaveBeenCalledWith(
              "get_tls_certificate_info",
              expect.objectContaining({
                proxyUrl: "http://proxy.example.test:3128/",
              }),
            );
          const routes = nativeRoutes(target.origin);
          expect(
            new Map(
              routes.map(({ upstreamOrigin, documents }) => [
                upstreamOrigin,
                documents,
              ]),
            ),
          ).toEqual(expectedGoogleOrigins(target.origin));
          expect(
            validateGoogleProxyRoutes(routes, url, proxyOrigin, true),
          ).toEqual(routes);
          for (const other of GOOGLE_SERVICE_PROFILES) {
            expect(
              routes.some(
                ({ upstreamOrigin }) =>
                  upstreamOrigin === new URL(other.hostedLoginUrl!).origin,
              ),
            ).toBe(new URL(other.hostedLoginUrl!).origin === target.origin);
          }
        },
      );

      it("passes only the explicitly selected existing Google staged-login mode", async () => {
        const target = new URL(url);
        configure(id, url, target.hostname, "form");
        render(<Harness />);
        await expectEntry(url);
        expect(starts()).toHaveLength(1);
        expect(starts()[0][1].config).toMatchObject({
          reviewed_application_profile: "google-hosted",
          upstream_auth_mode: "google-form",
          ...credentials,
          http_auto_login: true,
          custom_headers: {},
          upstream_proxy_url: "http://proxy.example.test:3128/",
        });
        expect(starts()[0][1].config.http_auto_login_selectors).toBeUndefined();
      });
    });

    it.each([
      [
        "google-forms",
        "https://docs.google.com/forms/",
        "https://docs.google.com/forms/d/example/edit?view=questions#page",
      ],
      [
        "google-play-store",
        "https://play.google.com/store/",
        "https://play.google.com/console/",
      ],
      [
        "google-play-console",
        "https://play.google.com/console/",
        "https://play.google.com/store/apps?hl=en#games",
      ],
    ])(
      "keeps the selected %s entry authoritative when a saved full URL uses another path",
      async (id, url, hostname) => {
        configure(id, url, hostname);
        render(<Harness />);
        await expectEntry(url);
        expect(fixture.connections[0].hostname).toBe(hostname);
      },
    );

    it.each([
      "missing manifest",
      "extra wildcard origin",
      "resource promoted to document",
      "direct origin as proxy alias",
    ])(
      "blocks a native response with %s without loading a direct page",
      async (problem) => {
        const url = "https://play.google.com/console/";
        configure("google-play-console", url, "play.google.com");
        fixture.mutateRoutes = (routes) => {
          if (problem === "missing manifest") return undefined;
          if (problem === "extra wildcard origin")
            return [
              ...routes,
              {
                upstreamOrigin: "https://*.google.com",
                proxyOrigin:
                  "http://pffffffffffffffffffffffffffffffff.localhost:43081",
                documents: true,
              },
            ];
          if (problem === "resource promoted to document")
            return routes.map((route) => ({ ...route, documents: true }));
          return routes.map((route) => ({
            ...route,
            proxyOrigin: route.upstreamOrigin,
          }));
        };
        render(<Harness />);
        await waitFor(() =>
          expect(screen.getByTestId("google-error")).toHaveTextContent(
            "blocked",
          ),
        );
        expect(screen.queryByTitle("Google service")).not.toBeInTheDocument();
        expect(starts()).toHaveLength(1);
        expect(fixture.invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
          sessionId: "google-service-native-fixture",
        });
      },
    );
  },
);
