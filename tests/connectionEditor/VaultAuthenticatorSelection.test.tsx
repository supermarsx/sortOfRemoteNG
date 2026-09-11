import React, { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConnectionContext } from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import CredentialSourceSection from "../../src/components/connectionEditor/CredentialSourceSection";
import AutomaticMfaSection from "../../src/components/connectionEditor/httpOptions/AutomaticMfaSection";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
import { normalizeConnectionCredentialSource } from "../../src/utils/security/databaseCredentialVault";

const credentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  totpId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let latest: Partial<Connection>;
let api: DatabaseCredentialVaultApi;
function Fixture({
  initial,
  automatic = false,
}: {
  initial: Partial<Connection>;
  automatic?: boolean;
}) {
  const [formData, setFormData] = useState(initial);
  latest = formData;
  const mgr = { formData, setFormData } as unknown as Parameters<
    typeof AutomaticMfaSection
  >[0]["mgr"];
  return (
    <ConnectionContext.Provider
      value={
        { credentialVault: api } as React.ContextType<typeof ConnectionContext>
      }
    >
      {automatic ? (
        <AutomaticMfaSection
          mgr={mgr}
          profile={getHttpApplicationProfile("wordpress")!}
        />
      ) : (
        <CredentialSourceSection
          formData={formData}
          setFormData={setFormData}
        />
      )}
    </ConnectionContext.Provider>
  );
}
beforeEach(() => {
  api = {
    scope: { databaseId: "owner", generation: 1 },
    changeRevision: 1,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async () => ({
      scope: { databaseId: "owner", generation: 1 },
      revision: 1,
      receipt: "read",
      entries: [
        {
          id: credentialId,
          name: "Vault account",
          createdAt: "2026-09-11",
          updatedAt: "2026-09-11",
          availableFacets: ["totp"],
        },
      ],
    })),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(async () => ({
      totp: [
        {
          id: totpId,
          label: "NAS authenticator",
          secret: "VAULT_SEED",
          algorithm: "sha1",
          digits: 6,
          period: 30,
        },
      ],
    })),
    compareAndSwap: vi.fn(),
  };
});
afterEach(cleanup);
const select = async (label: string, option: string) => {
  const control = screen.getByRole("combobox", { name: label });
  await waitFor(() => expect(control).toBeEnabled());
  fireEvent.click(control);
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};
it("removes the optional authenticator field on None and atomically disarms prior automatic consent", async () => {
  render(
    <Fixture
      initial={{
        credentialSource: { kind: "vault", credentialId, totpId },
        httpAutoMfa: {
          version: 1,
          enabled: true,
          totpConfigId: totpId,
          challengeId: "wordpress-two-factor-totp",
          origin: "https://nas.test",
        },
      }}
    />,
  );
  await select(
    "Vault authenticator for login challenges",
    "None — enter codes manually",
  );
  expect(
    Object.prototype.hasOwnProperty.call(latest.credentialSource!, "totpId"),
  ).toBe(false);
  expect(() =>
    normalizeConnectionCredentialSource(latest.credentialSource),
  ).not.toThrow();
  expect(latest.httpAutoMfa).toEqual({ version: 1, enabled: false });
  expect(JSON.stringify(latest)).not.toContain("VAULT_SEED");
});
it("requires new consent after switching from vault to connection-local credentials", () => {
  render(
    <Fixture
      initial={{
        credentialSource: { kind: "vault", credentialId, totpId },
        httpAutoMfa: {
          version: 1,
          enabled: true,
          totpConfigId: totpId,
          challengeId: "wordpress-two-factor-totp",
          origin: "https://nas.test",
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Connection-local" }));
  expect(latest.credentialSource).toEqual({ kind: "local" });
  expect(latest.httpAutoMfa).toEqual({ version: 1, enabled: false });
});
it("links an explicit vault authenticator and reviewed HTTPS challenge without selecting first or copying local/vault seeds", async () => {
  render(
    <Fixture
      automatic
      initial={{
        protocol: "https",
        hostname: "nas.test",
        port: 443,
        httpApplication: { version: 1, id: "wordpress", loginMode: "manual" },
        credentialSource: { kind: "vault", credentialId },
        totpConfigs: [
          {
            id: "ignored",
            account: "Local ignored",
            issuer: "Local",
            secret: "LOCAL_SEED",
            algorithm: "sha1",
            digits: 6,
            period: 30,
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByRole("button", {
      name: "Enable automatic codes for this origin",
    }),
  ).toBeDisabled();
  await select("Vault authenticator", "NAS authenticator");
  expect(latest.credentialSource).toEqual({
    kind: "vault",
    credentialId,
    totpId,
  });
  expect(latest.httpAutoMfa?.enabled).toBe(false);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Enable automatic codes for this origin",
    }),
  );
  expect(latest.httpAutoMfa).toMatchObject({
    enabled: true,
    totpConfigId: totpId,
    origin: "https://nas.test",
    challengeId: "wordpress-two-factor-totp",
  });
  expect(latest.totpConfigs?.[0].secret).toBe("LOCAL_SEED");
  expect(JSON.stringify(latest)).not.toContain("VAULT_SEED");
  await select("Vault authenticator", "Choose an authenticator");
  expect(
    Object.prototype.hasOwnProperty.call(latest.credentialSource!, "totpId"),
  ).toBe(false);
  expect(latest.httpAutoMfa?.enabled).toBe(false);
});
