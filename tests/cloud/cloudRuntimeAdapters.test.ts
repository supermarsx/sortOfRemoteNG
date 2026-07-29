import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../src/types/connection/connection";
import {
  azureRuntimeAdapter,
  digitalOceanRuntimeAdapter,
  gcpRuntimeAdapter,
  herokuRuntimeAdapter,
  ibmCloudRuntimeAdapter,
  linodeRuntimeAdapter,
  ovhCloudRuntimeAdapter,
  scalewayRuntimeAdapter,
} from "../../src/utils/session/cloudRuntimeAdapters";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const connection = (overrides: Partial<Connection> = {}) =>
  ({
    id: "cloud-saved",
    name: "Cloud account",
    protocol: "gcp",
    password: '{"type":"service_account"}',
    gcpSettings: {
      projectId: "project-a",
      region: "europe-west1",
      zone: "europe-west1-b",
    },
    ...overrides,
  }) as Connection;

describe("active cloud runtime adapters", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("maps GCP config with Rust field names and disconnects by handle", async () => {
    invokeMock.mockResolvedValueOnce("gcp-session");
    const handle = await gcpRuntimeAdapter.connect(connection());

    expect(invokeMock).toHaveBeenCalledWith("connect_gcp", {
      config: {
        project_id: "project-a",
        service_account_key: '{"type":"service_account"}',
        region: "europe-west1",
        zone: "europe-west1-b",
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        endpoint_override: null,
      },
    });

    await gcpRuntimeAdapter.disconnect(handle);
    expect(invokeMock).toHaveBeenLastCalledWith("disconnect_gcp", {
      sessionId: "gcp-session",
    });
  });

  it("sets Azure credentials, authenticates, and clears its token", async () => {
    const azureConnection = connection({
      protocol: "azure",
      password: "client-secret",
      gcpSettings: undefined,
      azureSettings: {
        tenantId: "tenant-a",
        clientId: "client-a",
        subscriptionId: "subscription-a",
        defaultResourceGroup: "rg-a",
        defaultRegion: "westeurope",
      },
    });

    await azureRuntimeAdapter.connect(azureConnection);

    expect(invokeMock.mock.calls.slice(0, 2)).toEqual([
      [
        "azure_set_credentials",
        {
          tenantId: "tenant-a",
          clientId: "client-a",
          clientSecret: "client-secret",
          subscriptionId: "subscription-a",
          defaultResourceGroup: "rg-a",
          defaultRegion: "westeurope",
        },
      ],
      ["azure_authenticate"],
    ]);

    await azureRuntimeAdapter.disconnect(undefined);
    expect(invokeMock).toHaveBeenLastCalledWith("azure_disconnect");
  });

  it("maps DigitalOcean config and disconnects its returned handle", async () => {
    const digitalOceanConnection = connection({
      protocol: "digital-ocean",
      password: "do-token",
      gcpSettings: undefined,
      digitalOceanSettings: { region: "lon1" },
    });
    invokeMock.mockResolvedValueOnce("do-session");

    const handle =
      await digitalOceanRuntimeAdapter.connect(digitalOceanConnection);

    expect(invokeMock).toHaveBeenCalledWith("connect_digital_ocean", {
      config: {
        api_token: "do-token",
        region: "lon1",
      },
    });

    await digitalOceanRuntimeAdapter.disconnect(handle);
    expect(invokeMock).toHaveBeenLastCalledWith(
      "disconnect_digital_ocean",
      { sessionId: "do-session" },
    );
  });

  it("maps IBM Cloud config and disconnects its returned handle", async () => {
    const ibmConnection = connection({
      protocol: "ibm-csp",
      password: "ibm-api-key",
      gcpSettings: undefined,
      ibmCloudSettings: {
        region: "eu-gb",
        resourceGroup: "resource-group-a",
      },
    });
    invokeMock.mockResolvedValueOnce("ibm-session");

    const handle = await ibmCloudRuntimeAdapter.connect(ibmConnection);

    expect(invokeMock).toHaveBeenCalledWith("connect_ibm", {
      config: {
        api_key: "ibm-api-key",
        region: "eu-gb",
        resource_group: "resource-group-a",
      },
    });
    await ibmCloudRuntimeAdapter.disconnect(handle);
    expect(invokeMock).toHaveBeenLastCalledWith("disconnect_ibm", {
      sessionId: "ibm-session",
    });
  });

  it("maps Heroku config and disconnects its returned handle", async () => {
    const herokuConnection = connection({
      protocol: "heroku",
      password: "heroku-api-key",
      gcpSettings: undefined,
      herokuSettings: { appName: "app-a", region: "eu" },
    });
    invokeMock.mockResolvedValueOnce("heroku-session");

    const handle = await herokuRuntimeAdapter.connect(herokuConnection);

    expect(invokeMock).toHaveBeenCalledWith("connect_heroku", {
      config: {
        api_key: "heroku-api-key",
        app_name: "app-a",
        region: "eu",
      },
    });
    await herokuRuntimeAdapter.disconnect(handle);
    expect(invokeMock).toHaveBeenLastCalledWith("disconnect_heroku", {
      sessionId: "heroku-session",
    });
  });

  it("maps Scaleway config and disconnects its returned handle", async () => {
    const scalewayConnection = connection({
      protocol: "scaleway",
      password: "scaleway-api-key",
      gcpSettings: undefined,
      scalewaySettings: {
        organizationId: "org-a",
        projectName: "project-a",
        region: "fr-par",
      },
    });
    invokeMock.mockResolvedValueOnce("scaleway-session");

    const handle = await scalewayRuntimeAdapter.connect(scalewayConnection);

    expect(invokeMock).toHaveBeenCalledWith("connect_scaleway", {
      config: {
        api_key: "scaleway-api-key",
        organization_id: "org-a",
        project_name: "project-a",
        region: "fr-par",
      },
    });
    await scalewayRuntimeAdapter.disconnect(handle);
    expect(invokeMock).toHaveBeenLastCalledWith("disconnect_scaleway", {
      sessionId: "scaleway-session",
    });
  });

  it("maps Linode config and disconnects its returned handle", async () => {
    const linodeConnection = connection({
      protocol: "linode",
      password: "linode-api-key",
      gcpSettings: undefined,
      linodeSettings: { region: "eu-west" },
    });
    invokeMock.mockResolvedValueOnce("linode-session");

    const handle = await linodeRuntimeAdapter.connect(linodeConnection);

    expect(invokeMock).toHaveBeenCalledWith("connect_linode", {
      config: {
        api_key: "linode-api-key",
        region: "eu-west",
      },
    });
    await linodeRuntimeAdapter.disconnect(handle);
    expect(invokeMock).toHaveBeenLastCalledWith("disconnect_linode", {
      sessionId: "linode-session",
    });
  });

  it("maps the OVHcloud credential bundle without adding secret settings", async () => {
    const ovhConnection = connection({
      protocol: "ovhcloud",
      password: JSON.stringify({
        apiKey: "ovh-api-key",
        appSecret: "ovh-app-secret",
        consumerKey: "ovh-consumer-key",
      }),
      gcpSettings: undefined,
      ovhCloudSettings: {
        serviceId: "service-a",
        projectName: "project-a",
        region: "GRA11",
      },
    });
    invokeMock.mockResolvedValueOnce("ovh-session");

    const handle = await ovhCloudRuntimeAdapter.connect(ovhConnection);

    expect(invokeMock).toHaveBeenCalledWith("connect_ovh", {
      config: {
        api_key: "ovh-api-key",
        app_secret: "ovh-app-secret",
        consumer_key: "ovh-consumer-key",
        service_id: "service-a",
        project_name: "project-a",
        region: "GRA11",
      },
    });
    await ovhCloudRuntimeAdapter.disconnect(handle);
    expect(invokeMock).toHaveBeenLastCalledWith("disconnect_ovh", {
      sessionId: "ovh-session",
    });
  });

  it("rejects incomplete OVHcloud credential JSON before invocation", () => {
    const ovhConnection = connection({
      protocol: "ovhcloud",
      password: JSON.stringify({ apiKey: "only-one-secret" }),
      gcpSettings: undefined,
    });

    expect(ovhCloudRuntimeAdapter.validate(ovhConnection)).toMatch(
      /apiKey, appSecret, and consumerKey/,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
