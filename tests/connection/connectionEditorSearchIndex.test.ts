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
    const postgresqlIndex = buildIndex({
      isGroup: false,
      protocol: "postgresql",
      username: "report_reader",
      database: "analytics",
      postgresSslMode: "verify-full",
      postgresCaCertificatePath: "C:\\certs\\postgres-root.pem",
      postgresConnectionTimeoutSecs: 20,
    });
    expect(
      searchConnectionEditorIndex(postgresqlIndex, "analytics")[0],
    ).toMatchObject({
      fieldId: "postgresql-database",
      protocolSubtabId: "connection",
    });
    expect(
      searchConnectionEditorIndex(postgresqlIndex, "report_reader")[0],
    ).toMatchObject({
      fieldId: "postgresql-username",
      protocolSubtabId: "authentication",
    });
    expect(
      searchConnectionEditorIndex(postgresqlIndex, "verify-full")[0],
    ).toMatchObject({
      fieldId: "postgresql-ssl-mode",
      protocolSubtabId: "security",
    });
    expect(
      searchConnectionEditorIndex(postgresqlIndex, "tunnel chain")[0],
    ).toMatchObject({
      fieldId: "postgresql-direct-route",
      protocolSubtabId: "advanced",
    });
    expect(
      postgresqlIndex.filter(
        (entry) => entry.fieldId === "postgresql-username",
      ),
    ).toHaveLength(1);
    expect(
      postgresqlIndex.filter((entry) => entry.fieldId === "username"),
    ).toHaveLength(0);
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

  it("indexes every native-display setting on its exact subtab without indexing secrets", () => {
    const spice = buildIndex({
      isGroup: false,
      protocol: "spice",
      spiceProxyUri: "http://display-proxy.example:3128",
      spiceTlsPort: 5901,
      spiceCaCertificatePath: "C:\\certs\\spice-ca.pem",
      password: "spice-ticket-never-searchable",
    });
    expect(
      searchConnectionEditorIndex(spice, "display-proxy.example")[0],
    ).toMatchObject({
      fieldId: "spice-proxy-uri",
      protocolSubtabId: "connection",
    });
    expect(searchConnectionEditorIndex(spice, "spice-ca.pem")[0]).toMatchObject(
      {
        fieldId: "spice-ca-certificate",
        protocolSubtabId: "security",
      },
    );
    expect(
      searchConnectionEditorIndex(spice, "spice-ticket-never-searchable"),
    ).toEqual([]);

    const xdmcp = buildIndex({
      isGroup: false,
      protocol: "xdmcp",
      xdmcpQueryType: "Indirect",
      xdmcpAcknowledgeInsecureTransport: true,
      xdmcpXServerPath: "C:\\XServers\\vcxsrv.exe",
    });
    expect(
      searchConnectionEditorIndex(xdmcp, "unauthenticated")[0],
    ).toMatchObject({
      fieldId: "xdmcp-insecure-warning",
      protocolSubtabId: "security",
    });
    expect(searchConnectionEditorIndex(xdmcp, "vcxsrv.exe")[0]).toMatchObject({
      fieldId: "xdmcp-x-server-path",
      protocolSubtabId: "advanced",
    });

    const x2go = buildIndex({
      isGroup: false,
      protocol: "x2go",
      username: "display-user",
      x2goSessionType: "Custom",
      x2goCommand: "start-special-desktop",
      privateKey: "x2go-private-key-never-searchable",
    });
    expect(
      searchConnectionEditorIndex(x2go, "start-special-desktop")[0],
    ).toMatchObject({
      fieldId: "x2go-command",
      protocolSubtabId: "connection",
    });
    expect(searchConnectionEditorIndex(x2go, "display-user")[0]).toMatchObject({
      fieldId: "x2go-username",
      protocolSubtabId: "authentication",
    });
    expect(
      searchConnectionEditorIndex(x2go, "x2go-private-key-never-searchable"),
    ).toEqual([]);

    const nx = buildIndex({
      isGroup: false,
      protocol: "nx",
      nxConnectionService: "ssh",
      nxSessionType: "Application",
      nxCustomCommand: "launch-special-app",
    });
    expect(
      searchConnectionEditorIndex(nx, "launch-special-app")[0],
    ).toMatchObject({
      fieldId: "nx-command",
      protocolSubtabId: "connection",
    });
    expect(
      searchConnectionEditorIndex(nx, "clipboard remains enabled")[0],
    ).toMatchObject({
      fieldId: "nx-native-input",
      protocolSubtabId: "display-input",
    });
  });

  it("indexes Serial framing, terminal, and driver settings on exact subtabs", () => {
    const serialIndex = buildIndex({
      isGroup: false,
      protocol: "serial",
      hostname: "COM9",
      serialSettings: {
        version: 1,
        portName: "COM9",
        baudRate: 115200,
        dataBits: "8",
        parity: "even",
        stopBits: "1",
        flowControl: "rtsCts",
        readTimeoutMs: 100,
        writeTimeoutMs: 1000,
        rxBufferSize: 4096,
        txBufferSize: 4096,
        dtrOnOpen: true,
        rtsOnOpen: true,
        lineEnding: "crLf",
        charDelayMs: 0,
        localEcho: false,
      },
    });

    expect(searchConnectionEditorIndex(serialIndex, "COM9")[0]).toMatchObject({
      fieldId: "serial-device",
      protocolSubtabId: "connection",
    });
    expect(searchConnectionEditorIndex(serialIndex, "115200")[0]).toMatchObject(
      {
        fieldId: "serial-baud-rate",
        protocolSubtabId: "connection",
      },
    );
    expect(
      searchConnectionEditorIndex(serialIndex, "CRLF").find(
        (entry) => entry.fieldId === "serial-line-ending",
      ),
    ).toMatchObject({ protocolSubtabId: "terminal" });
    expect(
      searchConnectionEditorIndex(serialIndex, "receive buffer").find(
        (entry) => entry.fieldId === "serial-buffers",
      ),
    ).toMatchObject({ protocolSubtabId: "advanced" });
    expect(serialIndex.map((entry) => entry.fieldId)).not.toContain("hostname");
    expect(serialIndex.map((entry) => entry.fieldId)).not.toContain("port");
    expect(serialIndex.map((entry) => entry.fieldId)).not.toContain("username");
    expect(serialIndex.map((entry) => entry.fieldId)).not.toContain("password");
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
