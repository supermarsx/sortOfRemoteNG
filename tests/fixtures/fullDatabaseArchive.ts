import type {
  Connection,
  ConnectionDatabase,
} from "../../src/types/connection/connection";
import type { StorageData } from "../../src/utils/storage/storage";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { createDocumentAttachment } from "../../src/utils/documents/documentAttachments";
import { emptyRecycleBin } from "../../src/utils/connection/recycleBin";
import type { TrustExportDocument } from "../../src/utils/auth/trustStore";

export const NOW = "2026-09-26T00:00:00.000Z";
export const VAULT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TOTP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const collection: ConnectionDatabase = {
  id: "source-db",
  name: "Full source",
  description: "Private complete database",
  isEncrypted: true,
  protectionFormat: "sorng-db",
  securityRevision: "source-revision",
  createdAt: NOW,
  updatedAt: NOW,
  lastAccessed: NOW,
};
export const trust: TrustExportDocument = {
  version: 1,
  policy: "strict",
  policyConfig: { expiry_days: 30 },
  records: [
    {
      host: "fixture.test:22",
      record_type: "ssh",
      user_approved: true,
      identity: {
        kind: "ssh",
        fingerprint: "SHA256:fixture",
        first_seen: NOW,
        last_seen: NOW,
      },
      description: "Retained trust metadata",
      history: [],
      revoked: true,
    },
  ],
};
export const connection = (id: string): Connection => ({
  id,
  name: id,
  protocol: "ssh",
  hostname: "fixture.test",
  port: 22,
  isGroup: false,
  createdAt: NOW,
  updatedAt: NOW,
});
export async function fullData(): Promise<StorageData> {
  const automationLibrary = emptyDatabaseAutomationLibrary();
  automationLibrary.terminalScripts.customScripts.push({
    id: "script",
    name: "Check host",
    description: "Fixture",
    script: "hostname",
    language: "bash",
    category: "Test",
    osTags: ["linux"],
    createdAt: NOW,
    updatedAt: NOW,
  });
  const linked: Connection = {
    ...connection("host"),
    parentId: "folder",
    credentialSource: {
      kind: "vault",
      credentialId: VAULT_ID,
      totpId: TOTP_ID,
    },
    sshQuickActions: {
      version: 1,
      items: [
        {
          kind: "script",
          id: "script",
          scope: { kind: "database", databaseId: collection.id },
        },
      ],
    },
    httpTrustedRedirectDestinations: {
      version: 1,
      origins: ["https://fixture.test"],
    },
  };
  const documents = emptyDatabaseDocuments();
  const attachment = await createDocumentAttachment(
    new TextEncoder().encode("PRIVATE_ATTACHMENT"),
    "fixture.txt",
    "text/plain",
  );
  documents.attachments.push(attachment);
  documents.documents.push({
    id: "document",
    name: "Private document",
    parentFolderId: "folder",
    icon: "file-text",
    createdAt: NOW,
    updatedAt: NOW,
    blocks: [
      {
        id: "secret",
        type: "credential",
        label: "Local",
        username: "fixture",
        password: "PRIVATE_DOCUMENT_PASSWORD",
        url: "https://fixture.test",
        notes: "private notes",
      },
      {
        id: "attachment",
        type: "attachment",
        attachmentId: attachment.id,
        caption: "Fixture",
      },
      {
        id: "link",
        type: "reference",
        label: "Host",
        reference: {
          databaseId: collection.id,
          kind: "connection",
          id: "host",
        },
      },
    ],
  });
  const recycleBin = emptyRecycleBin();
  recycleBin.entries.push({
    id: "deleted-row",
    batchId: "deleted-batch",
    deletedAt: Date.parse(NOW),
    connection: { ...linked, id: "archived" },
  });
  return {
    timestamp: Date.parse(NOW),
    settings: { theme: "dark" },
    connections: [
      { ...connection("folder"), isGroup: true },
      linked,
      {
        ...connection("local"),
        password: "PRIVATE_LOCAL_PASSWORD",
        security: {
          sshTunnel: {
            enabled: true,
            connectionId: "host",
            localPort: 2222,
            remoteHost: "fixture.test",
            remotePort: 22,
          },
        },
      },
    ],
    automationLibrary,
    documents,
    recycleBin,
    tabGroups: [],
    colorTags: { custom: { name: "Custom", color: "#123456" } },
    credentialVault: {
      version: 1,
      revision: 3,
      entries: [
        {
          id: VAULT_ID,
          name: "Shared login",
          createdAt: NOW,
          updatedAt: NOW,
          facets: {
            username: "fixture",
            password: "PRIVATE_VAULT_PASSWORD",
            totp: [
              {
                id: TOTP_ID,
                label: "OTP",
                secret: "JBSWY3DPEHPK3PXP",
                digits: 6,
                period: 30,
                algorithm: "sha1",
              },
            ],
            deviceTrust: [
              {
                id: TOTP_ID,
                surface: "synology-api",
                target: "https://fixture.test",
                account: "fixture",
                deviceName: "OLD_DEVICE",
                deviceId: "PRIVATE_DEVICE_TOKEN",
                createdAt: NOW,
                portable: false,
              },
            ],
          },
        },
      ],
    },
  };
}
