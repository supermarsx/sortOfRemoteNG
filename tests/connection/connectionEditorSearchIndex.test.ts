import { describe, expect, it } from "vitest";
import {
  buildConnectionEditorSearchIndex,
  getSafeConnectionEditorSearchValues,
  isSensitiveConnectionEditorSearchPath,
  searchConnectionEditorIndex,
} from "../../src/components/connection/editor/connectionEditorSearchIndex";
import {
  CONNECTION_EDITOR_TABS,
  getConnectionEditorSearchDescriptors,
} from "../../src/components/connection/editor/editorRegistry";

const buildIndex = (
  formData: Record<string, unknown>,
  dynamicValues?: Record<string, readonly string[]>,
) =>
  buildConnectionEditorSearchIndex({
    descriptors: getConnectionEditorSearchDescriptors(
      formData.isGroup === true,
    ),
    tabs: CONNECTION_EDITOR_TABS,
    formData,
    dynamicValues,
  });

describe("connection editor search index", () => {
  it("indexes visible copy, option text, dynamic choices, and safe current values", () => {
    const index = buildIndex(
      {
        isGroup: false,
        protocol: "rdp",
        name: "Production Bastion",
        hostname: "bastion.internal.example",
        description: "Owned by Platform Engineering",
        tags: ["production", "linux"],
      },
      {
        protocol: ["Remote Desktop", "Secure Shell"],
        "parent-folder": ["Infrastructure / Production"],
        icon: ["Terminal", "Shield"],
        tags: ["platform"],
      },
    );

    expect(searchConnectionEditorIndex(index, "Platform Engineering")).toEqual([
      expect.objectContaining({
        sectionId: "notes-description",
        fieldId: "description",
        breadcrumb: "Notes / Description & Notes",
      }),
    ]);
    expect(
      searchConnectionEditorIndex(index, "Infrastructure / Production"),
    ).toEqual([
      expect.objectContaining({
        sectionId: "general-parent",
        fieldId: "parent-folder",
      }),
    ]);
    expect(searchConnectionEditorIndex(index, "Secure Shell")[0]).toEqual(
      expect.objectContaining({ fieldId: "protocol" }),
    );
    const httpIndex = buildIndex({ isGroup: false, protocol: "https" });
    expect(searchConnectionEditorIndex(httpIndex, "self-signed")[0]).toEqual(
      expect.objectContaining({ fieldId: "http-tls" }),
    );
  });

  it("never exposes password, token, key, secret, answer, code, or seed values", () => {
    const formData = {
      name: "Safe display name",
      password: "password-value-never-searchable",
      integration: {
        instanceName: "Visible instance",
        authToken: "token-value-never-searchable",
        apiKey: "key-value-never-searchable",
        providerSecrets: { clientSecret: "secret-value-never-searchable" },
      },
      securityQuestions: [
        { question: "First school?", answer: "answer-value-never-searchable" },
      ],
      recoveryInfo: {
        alternativeEmail: "visible-recovery@example.com",
        seedPhrase: "seed-value-never-searchable",
      },
      backupCodes: ["code-value-never-searchable"],
    };

    const values = getSafeConnectionEditorSearchValues(formData, [
      "name",
      "integration",
      "securityQuestions",
      "recoveryInfo",
      "backupCodes",
      "password",
    ]);

    expect(values).toEqual([
      "Safe display name",
      "Visible instance",
      "First school?",
      "visible-recovery@example.com",
    ]);
    expect(isSensitiveConnectionEditorSearchPath("integration.authToken")).toBe(
      true,
    );
    expect(
      isSensitiveConnectionEditorSearchPath("cloudProvider.serviceAccountKey"),
    ).toBe(true);
    expect(isSensitiveConnectionEditorSearchPath("tags.0")).toBe(false);

    const networkPathIndex = buildIndex({
      isGroup: false,
      protocol: "ssh",
      security: {
        proxy: {
          type: "socks5",
          host: "proxy.example.test",
          port: 1080,
          username: "visible-proxy-user",
          password: "network-path-password-never-searchable",
          enabled: true,
        },
      },
    });
    expect(
      searchConnectionEditorIndex(
        networkPathIndex,
        "network-path-password-never-searchable",
      ),
    ).toEqual([]);
  });

  it("keeps group and protocol-dependent fields accurate", () => {
    const folderIndex = buildIndex({
      isGroup: true,
      protocol: "rdp",
      name: "Infrastructure",
    });
    const folderFields = folderIndex.map((entry) => entry.fieldId);
    expect(folderFields).not.toContain("protocol");
    expect(folderFields).not.toContain("favorite");
    expect(folderFields).not.toContain("focus-on-connect");
    expect(folderFields).toContain("name");
    expect(folderFields).toContain("description");

    const sshFields = buildIndex({ isGroup: false, protocol: "ssh" }).map(
      (entry) => entry.fieldId,
    );
    expect(sshFields).toContain("ssh-known-hosts");
    expect(sshFields).not.toContain("rdp-display");
    expect(sshFields).not.toContain("http-authentication");
    expect(sshFields).not.toContain("focus-on-winmgmt-tool");

    const windowsSshFields = buildIndex({
      isGroup: false,
      protocol: "ssh",
      osType: "windows",
    }).map((entry) => entry.fieldId);
    expect(windowsSshFields).toContain("winrm-options");
    expect(windowsSshFields).toContain("focus-on-winmgmt-tool");
  });

  it("projects protocol search fields onto their owning protocol subtabs", () => {
    const rdpIndex = buildIndex({ isGroup: false, protocol: "rdp" });
    expect(
      rdpIndex.find((entry) => entry.fieldId === "rdp-display"),
    ).toMatchObject({ protocolSubtabId: "display-input" });
    expect(
      rdpIndex.find((entry) => entry.fieldId === "rdp-gateway"),
    ).toMatchObject({ protocolSubtabId: "network" });
    expect(
      rdpIndex.find((entry) => entry.fieldId === "rdp-performance"),
    ).toMatchObject({ protocolSubtabId: "resources" });
    expect(
      rdpIndex.find((entry) => entry.fieldId === "network-path"),
    ).toMatchObject({ protocolSubtabId: "network-path" });

    const sshIndex = buildIndex({ isGroup: false, protocol: "ssh" });
    expect(
      sshIndex.find((entry) => entry.fieldId === "network-path"),
    ).toMatchObject({ protocolSubtabId: "network-path" });

    for (const protocol of ["raw", "rlogin", "winrm"] as const) {
      expect(
        buildIndex({ isGroup: false, protocol }).find(
          (entry) => entry.fieldId === "network-path",
        ),
      ).toMatchObject({ protocolSubtabId: "network-path" });
    }

    const httpsIndex = buildIndex({ isGroup: false, protocol: "https" });
    expect(
      httpsIndex.find((entry) => entry.fieldId === "http-tls"),
    ).toMatchObject({ protocolSubtabId: "security" });
    expect(
      httpsIndex.find((entry) => entry.fieldId === "http-bookmarks"),
    ).toMatchObject({ protocolSubtabId: "advanced" });

    const winrmIndex = buildIndex({ isGroup: false, protocol: "winrm" });
    expect(
      winrmIndex.find((entry) => entry.fieldId === "winrm-options"),
    ).toMatchObject({ protocolSubtabId: "connection" });
  });

  it("indexes Raw, RLogin, and PowerShell settings on their exact subtabs", () => {
    const rawIndex = buildIndex({
      isGroup: false,
      protocol: "raw",
      rawSocketSettings: {
        connection: { transport: "udp" },
        data: { displayEncoding: "base64" },
      },
    });
    expect(
      rawIndex.find((entry) => entry.fieldId === "raw-socket-transport"),
    ).toMatchObject({
      sectionId: "raw-socket-options",
      protocolSubtabId: "connection",
    });
    expect(
      searchConnectionEditorIndex(rawIndex, "base64").find(
        (entry) => entry.fieldId === "raw-socket-display-encoding",
      ),
    ).toMatchObject({ protocolSubtabId: "terminal" });
    expect(rawIndex.map((entry) => entry.fieldId)).not.toContain("username");
    expect(rawIndex.map((entry) => entry.fieldId)).not.toContain("password");

    const rloginIndex = buildIndex({
      isGroup: false,
      protocol: "rlogin",
      rloginSettings: { escapeCharacter: "^]" },
    });
    expect(
      searchConnectionEditorIndex(rloginIndex, "plaintext risk").find(
        (entry) => entry.fieldId === "rlogin-plaintext-acknowledgement",
      ),
    ).toMatchObject({
      sectionId: "rlogin-security",
      protocolSubtabId: "security",
    });
    expect(rloginIndex.map((entry) => entry.fieldId)).not.toContain("username");
    expect(rloginIndex.map((entry) => entry.fieldId)).not.toContain("password");

    const powershellIndex = buildIndex({
      isGroup: false,
      protocol: "winrm",
      powerShellRemoting: {
        wsman: { port: 5986 },
        credential: { username: "ps-admin" },
      },
    });
    expect(
      powershellIndex.find(
        (entry) => entry.fieldId === "powershell-wsman-port",
      ),
    ).toMatchObject({
      sectionId: "powershell-remoting-options",
      protocolSubtabId: "connection",
    });
    expect(
      searchConnectionEditorIndex(powershellIndex, "ps-admin").find(
        (entry) => entry.fieldId === "powershell-username",
      ),
    ).toMatchObject({ protocolSubtabId: "authentication" });
  });

  it("indexes ARD and saved-protocol settings on their truthful subtabs", () => {
    const ardIndex = buildIndex({
      isGroup: false,
      protocol: "ard",
      ardSettings: { authMode: "appleAccountNative" },
      username: "not-an-apple-account-field",
      password: "apple-password-must-never-be-indexed",
    });
    expect(
      searchConnectionEditorIndex(ardIndex, "Screen Sharing handoff")[0],
    ).toMatchObject({
      fieldId: "ard-native-handoff",
      protocolSubtabId: "authentication",
    });
    expect(
      searchConnectionEditorIndex(ardIndex, "ARD display and input")[0],
    ).toMatchObject({
      fieldId: "ard-display-input",
      protocolSubtabId: "display-input",
    });
    expect(ardIndex.map((entry) => entry.fieldId)).not.toContain("username");
    expect(ardIndex.map((entry) => entry.fieldId)).not.toContain("password");
    expect(
      searchConnectionEditorIndex(
        ardIndex,
        "apple-password-must-never-be-indexed",
      ),
    ).toEqual([]);

    expect(
      buildIndex({ isGroup: false, protocol: "sftp" }).find(
        (entry) => entry.fieldId === "sftp-auth-type",
      ),
    ).toMatchObject({ protocolSubtabId: "authentication" });
    expect(
      searchConnectionEditorIndex(
        buildIndex({
          isGroup: false,
          protocol: "mysql",
          database: "inventory_schema",
        }),
        "inventory_schema",
      )[0],
    ).toMatchObject({
      fieldId: "mysql-database",
      protocolSubtabId: "connection",
    });
    expect(
      buildIndex({ isGroup: false, protocol: "smb", shareName: "Shared" }).find(
        (entry) => entry.fieldId === "smb-share",
      ),
    ).toMatchObject({ protocolSubtabId: "connection" });
    expect(
      buildIndex({
        isGroup: false,
        protocol: "rustdesk",
        rustdeskId: "123-456",
      }).find((entry) => entry.fieldId === "rustdesk-id"),
    ).toMatchObject({ protocolSubtabId: "connection" });
  });

  it("excludes exchange fields hidden by the selected environment", () => {
    const onlineFields = buildIndex({
      isGroup: false,
      protocol: "integration:exchange",
      integration: { providerFields: { environment: "online" } },
    }).map((entry) => entry.fieldId);
    expect(onlineFields).toContain("exchange-tenant-id");
    expect(onlineFields).not.toContain("exchange-server");
    expect(onlineFields).not.toContain("hostname");
    expect(onlineFields).not.toContain("username");
    expect(onlineFields).not.toContain("password");

    const onPremisesFields = buildIndex({
      isGroup: false,
      protocol: "integration:exchange",
      integration: { providerFields: { environment: "onPremises" } },
    }).map((entry) => entry.fieldId);
    expect(onPremisesFields).not.toContain("exchange-tenant-id");
    expect(onPremisesFields).toContain("exchange-server");
    expect(onPremisesFields).toContain("exchange-port");
  });

  it("projects current automation rules and action values into exact dynamic fields", () => {
    const index = buildIndex({
      isGroup: false,
      protocol: "rdp",
      behaviorAutomation: {
        version: 1,
        rules: [
          {
            id: "rule-connected",
            name: "Notify operations",
            event: "connected",
            actions: [
              {
                type: "notify",
                title: "Session ready",
                message: "Production connection established",
                level: "info",
              },
            ],
          },
        ],
      },
    });

    expect(searchConnectionEditorIndex(index, "Notify operations")[0]).toEqual(
      expect.objectContaining({
        sectionId: "behavior-automation",
        fieldId: "automation-rule-1-name",
        focusId: "behavior-rule-rule-connected-name",
      }),
    );
    expect(
      searchConnectionEditorIndex(
        index,
        "Production connection established",
      )[0],
    ).toEqual(
      expect.objectContaining({
        fieldId: "behavior-rule-1-action-1-message",
        focusId: "behavior-rule-1-action-1-message",
      }),
    );
  });

  it("indexes wired window lifecycle events, filters, and action metadata", () => {
    const index = buildIndex({
      isGroup: false,
      protocol: "ssh",
      behaviorAutomation: {
        version: 1,
        rules: [
          {
            id: "window-rule",
            name: "Restore detached shell",
            event: "window.closed",
            when: { windowKinds: ["detached"] },
            actions: [
              { type: "focusSession", restoreIfMinimized: true },
              { type: "closeTab", respectClosePolicy: true },
              { type: "setOwningWindowState", state: "restored" },
            ],
          },
        ],
      },
    });

    expect(searchConnectionEditorIndex(index, "Window closed")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionId: "behavior-automation",
          fieldId: "automation-rule-1-event",
        }),
      ]),
    );
    expect(searchConnectionEditorIndex(index, "Detached windows")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: "automation-rule-1-window-kinds",
        }),
      ]),
    );
    expect(searchConnectionEditorIndex(index, "Restored")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: "behavior-rule-1-action-3-window-state",
        }),
      ]),
    );
    expect(
      searchConnectionEditorIndex(index, "existing close confirmation"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: "behavior-rule-1-action-2-close-policy",
        }),
      ]),
    );
  });

  it("searches case-insensitively with stable registry order and snippets", () => {
    const index = buildIndex({
      isGroup: false,
      protocol: "rdp",
      name: "Primary production endpoint",
      description: "Production operating notes",
      tags: ["production"],
    });

    const first = searchConnectionEditorIndex(index, "PRODUCTION");
    const second = searchConnectionEditorIndex(index, "production");

    expect(second.map((result) => result.id)).toEqual(
      first.map((result) => result.id),
    );
    expect(first.map((result) => result.fieldId)).toEqual([
      "name",
      "tags",
      "description",
    ]);
    expect(first[0].snippet.toLocaleLowerCase()).toContain("production");
  });
});
