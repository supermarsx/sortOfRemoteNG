import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => ({
  findDescriptor: vi.fn(),
  importPanel: vi.fn(),
  panelProps: vi.fn(),
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  store: {
    instances: [] as any[],
    isLoading: false,
    error: null as string | null,
  },
}));

vi.mock("../../types/integrations/registry", () => ({
  findDescriptor: (key: string) => hostMocks.findDescriptor(key),
}));

vi.mock("../../hooks/integrations/useIntegrationConfigStore", () => ({
  useIntegrationConfigStore: () => ({
    ...hostMocks.store,
    createInstance: hostMocks.createInstance,
    updateInstance: hostMocks.updateInstance,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import { IntegrationPanelHost } from "./IntegrationPanelHost";

describe("IntegrationPanelHost secure launch bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostMocks.store.instances = [];
    hostMocks.store.isLoading = false;
    hostMocks.store.error = null;
    hostMocks.importPanel.mockResolvedValue({
      default: (props: Record<string, unknown>) => {
        hostMocks.panelProps(props);
        return React.createElement(
          "div",
          { "data-testid": "resolved-integration-panel" },
          String(props.instanceId ?? "new"),
        );
      },
    });
    hostMocks.findDescriptor.mockImplementation((key: string) => ({
      key,
      label: key,
      category: "management",
      importPanel: hostMocks.importPanel,
    }));
  });

  it("resolves the exact existing instance through the vault-backed store before mounting", async () => {
    const existing = {
      id: "grafana-selected",
      integrationKey: "grafana",
      name: "Existing Grafana",
      host: "https://old.example.test",
      fields: { organization: "old" },
      credentialRefId: "old-primary-ref",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    };
    hostMocks.store.instances = [existing];
    hostMocks.updateInstance.mockResolvedValue({
      ...existing,
      host: "https://grafana.example.test",
      credentialRefId: "rotated-primary-ref",
      credentialRefIds: { apiKey: "rotated-api-key-ref" },
    });

    render(
      <IntegrationPanelHost
        sessionId="session-grafana"
        descriptorKey="grafana"
        instanceId="grafana-selected"
        integrationSettings={{
          descriptorKey: "grafana",
          instanceId: "grafana-selected",
          instanceName: "Production Grafana",
          host: "https://grafana.example.test",
          username: "operator",
          apiKey: "runtime-api-key",
          tlsVerify: true,
          timeout: 45,
          providerFields: {
            organization: "production",
            client_secret: "must-not-reach-config",
            "api-key": "must-not-reach-config",
          },
        }}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByTestId("resolved-integration-panel"),
    ).toHaveTextContent("grafana-selected");
    expect(hostMocks.updateInstance).toHaveBeenCalledWith(
      "grafana-selected",
      expect.objectContaining({
        integrationKey: "grafana",
        name: "Production Grafana",
        host: "https://grafana.example.test",
        fields: expect.objectContaining({
          organization: "production",
          username: "operator",
          authMode: "apiKey",
          tlsVerify: "true",
          timeout: "45",
        }),
        secret: "runtime-api-key",
        secrets: { apiKey: "runtime-api-key" },
      }),
    );
    const updatePayload = hostMocks.updateInstance.mock.calls[0]?.[1] as {
      fields: Record<string, string>;
    };
    expect(updatePayload.fields).not.toHaveProperty("client_secret");
    expect(updatePayload.fields).not.toHaveProperty("api-key");
    expect(hostMocks.createInstance).not.toHaveBeenCalled();
    expect(hostMocks.panelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        instanceId: "grafana-selected",
      }),
    );
  });

  it("blocks generic or missing Mail instances instead of routing to the first service", async () => {
    hostMocks.store.instances = [
      {
        id: "generic-mail",
        integrationKey: "mail",
        name: "Legacy generic Mail",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
      {
        id: "postfix-other",
        integrationKey: "mail.postfix",
        name: "Another Postfix",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ];

    render(
      <IntegrationPanelHost
        sessionId="session-mail"
        descriptorKey="mail"
        instanceId="generic-mail"
        integrationSettings={{
          descriptorKey: "mail",
          instanceId: "generic-mail",
        }}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByText(/Generic Mail instances cannot be routed/i),
    ).toBeVisible();
    expect(hostMocks.createInstance).not.toHaveBeenCalled();
    expect(hostMocks.updateInstance).not.toHaveBeenCalled();
    await waitFor(() => expect(hostMocks.panelProps).not.toHaveBeenCalled());
  });
});
