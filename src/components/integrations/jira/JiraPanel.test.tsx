import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import JiraPanel from "./JiraPanel";
import { jiraDescriptor } from "./descriptor";
import { jiraConnectionApi } from "../../../hooks/integration/jira/useJiraConnection";
import { resetIntegrationConfigStoreForTests } from "../../../hooks/integrations/useIntegrationConfigStore";

let persisted: string | null;

beforeEach(() => {
  persisted = null;
  invokeMock.mockReset();
  resetIntegrationConfigStoreForTests();
  invokeMock.mockImplementation(
    (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "read_app_data":
          return Promise.resolve(persisted);
        case "compare_and_swap_app_data": {
          const request = args as {
            expected: string | null;
            replacement: string;
          };
          if (request.expected !== persisted) return Promise.resolve(false);
          persisted = request.replacement;
          return Promise.resolve(true);
        }
        case "vault_store_secret":
        case "vault_delete_secret":
          return Promise.resolve(undefined);
        case "jira_connect":
          return Promise.resolve({
            connected: true,
            server_title: "Acme Jira",
            version: "9.12.0",
            deployment_type: "Server",
          });
        default:
          return Promise.resolve(null);
      }
    },
  );
});

async function fillCloudForm() {
  await waitFor(() =>
    expect(
      screen.getByPlaceholderText("https://acme.atlassian.net"),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByPlaceholderText("https://acme.atlassian.net"), {
    target: { value: "https://acme.atlassian.net" },
  });
  fireEvent.change(screen.getByPlaceholderText("jsmith@acme.com"), {
    target: { value: "jsmith@acme.com" },
  });
}

describe("JiraPanel", () => {
  it("renders the connect form when no instance is bound", async () => {
    render(<JiraPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("https://acme.atlassian.net"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^Connect$/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to jira_connect with a snake_case config + externally-tagged auth", async () => {
    const { container } = render(<JiraPanel isOpen onClose={() => {}} />);
    await fillCloudForm();
    const token = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(token, { target: { value: "api-tok-123" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "jira_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "https://acme.atlassian.net",
            api_version: "2",
            skip_tls_verify: false,
            acknowledge_invalid_cert_risk: false,
            auth: {
              ApiToken: { email: "jsmith@acme.com", token: "api-tok-123" },
            },
          }),
        }),
      ),
    );
  });

  it("stores the secret in the vault, never in the config blob", async () => {
    const { container } = render(<JiraPanel isOpen onClose={() => {}} />);
    await fillCloudForm();
    const token = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(token, { target: { value: "api-tok-123" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vault_store_secret",
        expect.objectContaining({
          secret: expect.stringContaining("api-tok-123"),
        }),
      ),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "compare_and_swap_app_data",
        expect.objectContaining({
          expected: null,
          replacement: expect.any(String),
        }),
      ),
    );
    expect(persisted).not.toBeNull();
    expect(persisted).not.toContain("api-tok-123");
    expect(JSON.parse(persisted!)).toEqual([
      expect.objectContaining({
        integrationKey: "jira",
        credentialRefId: expect.any(String),
      }),
    ]);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "write_app_data",
      expect.anything(),
    );
  });

  it("exposes a well-formed app-service descriptor", () => {
    expect(jiraDescriptor.key).toBe("jira");
    expect(jiraDescriptor.category).toBe("business-app");
    expect(typeof jiraDescriptor.importPanel).toBe("function");
  });

  it("connection api wrappers map to the correct command names", () => {
    jiraConnectionApi.disconnect("inst-1");
    jiraConnectionApi.ping("inst-1");
    jiraConnectionApi.listConnections();
    expect(invokeMock).toHaveBeenCalledWith("jira_disconnect", {
      id: "inst-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("jira_ping", { id: "inst-1" });
    expect(invokeMock).toHaveBeenCalledWith("jira_list_connections", undefined);
  });
});
