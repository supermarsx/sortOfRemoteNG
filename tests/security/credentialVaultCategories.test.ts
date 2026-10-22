import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_CATEGORIES,
  connectionCredentialCategories,
  vaultCredentialCategories,
} from "../../src/utils/security/credentialVaultCategories";
import { credentialVaultAssignments } from "../../src/utils/security/credentialVaultUsage";
import type { Connection } from "../../src/types/connection/connection";
import type { ConnectionCredentialInventoryRow } from "../../src/utils/security/connectionCredentialInventory";

describe("credential category and assignment metadata", () => {
  it("classifies existing kinds and protocol/auth modes without secret content or ambiguous domain assumptions", () => {
    expect(CREDENTIAL_CATEGORIES).toHaveLength(8);
    expect(
      connectionCredentialCategories({ protocol: "smtp", kinds: ["password"] }),
    ).toEqual(["SMTP", "User/password"]);
    expect(
      connectionCredentialCategories(
        { protocol: "https", kinds: ["webAuth"] },
        "digest",
      ),
    ).toEqual(["Digest"]);
    expect(
      connectionCredentialCategories({
        protocol: "ssh",
        kinds: ["privateKey", "vpn"],
      }),
    ).toEqual(["Private key", "VPN"]);
    expect(
      connectionCredentialCategories({
        protocol: "rustdesk",
        kinds: ["password"],
      }),
    ).toContain("Remote access key");
    expect(vaultCredentialCategories({ availableFacets: ["domain"] })).toEqual([
      "Other",
    ]);
    expect(
      vaultCredentialCategories(
        { availableFacets: ["password"], tags: ["SMTP", "Finance"] },
        ["SMTP", "Other"],
      ),
    ).toEqual(["User/password", "SMTP", "Finance"]);
  });

  it("projects distinct saved assignments and known application labels without reading credential values", () => {
    const connection = {
      id: "c1",
      name: "Control panel",
      protocol: "https",
      httpApplication: { version: 1, id: "webmin", loginMode: "digest" },
      credentialSource: { kind: "vault", credentialId: "entry" },
    } as Connection;
    Object.defineProperty(connection, "password", {
      get: () => {
        throw new Error("Secret value must not be read");
      },
    });
    const inventory = [
      {
        id: "c1",
        name: "Control panel",
        protocol: "https",
        kinds: ["vault"],
        storage: ["vault"],
        localValuesIgnored: false,
      },
    ] as ConnectionCredentialInventoryRow[];
    const result = credentialVaultAssignments(
      [
        connection,
        connection,
        { ...connection, id: "c2", credentialSource: { kind: "local" } },
      ],
      inventory,
    );
    expect(result.get("entry")).toEqual([
      {
        connectionId: "c1",
        name: "Control panel",
        protocol: "https",
        application: "Webmin",
        categories: ["Digest"],
      },
    ]);
    expect(JSON.stringify(result.get("entry"))).not.toMatch(
      /https?:\/\/|credentialId|password/,
    );
    const unrelatedLocalKinds = credentialVaultAssignments(
      [{ ...connection, protocol: "ssh", httpApplication: undefined }],
      [
        {
          ...inventory[0],
          protocol: "ssh",
          kinds: ["vault", "vpn", "privateKey"],
        },
      ],
    ).get("entry")![0].categories;
    expect(
      vaultCredentialCategories(
        { availableFacets: ["password"] },
        unrelatedLocalKinds,
      ),
    ).toEqual(["User/password"]);
  });
});
