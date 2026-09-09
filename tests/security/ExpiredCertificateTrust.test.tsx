import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { TrustExportRecord } from "../../src/utils/auth/trustStore";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  saved: "[]",
  decision: null as string | null,
  databaseId: "expiry-fixture-db",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
import {
  ensureTrustStoreReady,
  getStoredIdentity,
  resetTrustStoreCacheForTests,
  trustIdentity,
  verifyIdentity,
  type CertIdentity,
} from "../../src/utils/auth/trustStore";
import { CertificateInfoPopup } from "../../src/components/security/CertificateInfoPopup";
import { TrustWarningDialog } from "../../src/components/security/TrustWarningDialog";
import SecurityInfoBar from "../../src/components/protocol/webBrowser/SecurityInfoBar";
import type { WebBrowserMgr } from "../../src/components/protocol/webBrowser/types";

const expired: CertIdentity = {
  fingerprint: "A1".repeat(32),
  subject: "CN=expired.example.test",
  issuer: "CN=Fixture CA",
  validFrom: "2000-01-01T00:00:00.000Z",
  validTo: "2001-01-01T00:00:00.000Z",
  firstSeen: "2026-09-09T00:00:00.000Z",
  lastSeen: "2026-09-09T00:00:00.000Z",
};
const host = "expired.example.test";

beforeEach(async () => {
  localStorage.clear();
  resetTrustStoreCacheForTests();
  native.saved = "[]";
  native.decision = null;
  native.databaseId = "expiry-fixture-db";
  native.invoke.mockReset();
  native.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      const records = JSON.parse(native.saved) as TrustExportRecord[];
      if (command === "trust_get_active_database")
        return {
          databaseId: native.databaseId,
          encrypted: false,
          recordCount: records.length,
          seededRecords: 0,
        };
      if (command === "trust_get_all_records") return records;
      if (args.expectedDatabaseId !== native.databaseId)
        throw new Error("fixture database scope changed");
      if (command === "trust_store_identity") {
        records.push({
          host: args.host as string,
          record_type: args.recordType as string,
          identity: args.identity as Record<string, unknown>,
          user_approved: args.userApproved as boolean,
          history: [],
        });
        // This test boundary represents durable native JSON, not renderer cache.
        native.saved = JSON.stringify(records);
        return;
      }
      if (command === "trust_verify_identity") {
        const record = records.find(
          (entry) =>
            entry.host === args.host && entry.record_type === args.recordType,
        );
        const presented = args.identity as Record<string, unknown>;
        if (native.decision)
          return {
            status: native.decision,
            stored: record?.identity,
            presented,
          };
        if (!record) return { status: "first-use", identity: presented };
        if (record.identity.fingerprint !== presented.fingerprint)
          return { status: "mismatch", stored: record.identity, presented };
        return { status: "trusted" };
      }
      throw new Error(`Unexpected fixture command: ${command}`);
    },
  );
  await ensureTrustStoreReady();
});
afterEach(cleanup);

describe("certificate validity is distinct from a remembered trust decision", () => {
  it("keeps explicit exact-fingerprint approval trusted after native storage and renderer reload", async () => {
    await trustIdentity(
      host,
      443,
      "https",
      expired,
      true,
      "fixture-connection",
    );
    expect(
      await verifyIdentity(host, 443, "https", expired, "fixture-connection"),
    ).toEqual({ status: "trusted" });
    resetTrustStoreCacheForTests();
    await ensureTrustStoreReady();
    expect(
      getStoredIdentity(host, 443, "https", "fixture-connection"),
    ).toMatchObject({
      userApproved: true,
      identity: { fingerprint: expired.fingerprint },
    });
    expect(
      await verifyIdentity(host, 443, "https", expired, "fixture-connection"),
    ).toEqual({ status: "trusted" });
    expect(
      native.invoke.mock.calls.filter(
        ([name]) => name === "trust_store_identity",
      ),
    ).toHaveLength(1);
  });

  it("requires explicit first-use review of expired certificates but leaves unexpired TOFU unchanged", async () => {
    expect(await verifyIdentity(host, 443, "https", expired)).toMatchObject({
      status: "first-use",
      requiresApproval: true,
    });
    expect(
      await verifyIdentity(host, 443, "https", {
        ...expired,
        validTo: "2999-01-01T00:00:00Z",
      }),
    ).toMatchObject({ status: "first-use" });
    expect(
      await verifyIdentity(host, 443, "https", {
        ...expired,
        validTo: "2999-01-01T00:00:00Z",
      }),
    ).not.toHaveProperty("requiresApproval");
    expect(native.saved).toBe("[]");
  });

  it("does not confuse native trust TTL expiry with the certificate validity warning", async () => {
    await trustIdentity(host, 443, "https", expired, true);
    native.decision = "expired";
    expect(await verifyIdentity(host, 443, "https", expired)).toMatchObject({
      status: "expired",
    });
  });

  it.each(["revoked", "pending-verification", "pending-threshold"])(
    "does not bypass native %s rejection for an expired approved certificate",
    async (decision) => {
      await trustIdentity(host, 443, "https", expired, true);
      native.decision = decision;
      await expect(
        verifyIdentity(host, 443, "https", expired),
      ).rejects.toThrow();
    },
  );

  it("still refuses a changed fingerprint or a different active database", async () => {
    await trustIdentity(host, 443, "https", expired, true);
    expect(
      await verifyIdentity(host, 443, "https", {
        ...expired,
        fingerprint: "B2".repeat(32),
      }),
    ).toMatchObject({ status: "mismatch" });
    native.databaseId = "another-fixture-db";
    await expect(verifyIdentity(host, 443, "https", expired)).rejects.toThrow();
  });

  it("shows Trusted alongside the expired validity date in the certificate inspector after reload", async () => {
    await trustIdentity(host, 443, "https", expired, true);
    resetTrustStoreCacheForTests();
    await ensureTrustStoreReady();
    const triggerRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={triggerRef}>Certificate details</button>
        <CertificateInfoPopup
          type="https"
          host={host}
          port={443}
          currentIdentity={expired}
          trustRecord={getStoredIdentity(host, 443, "https")}
          triggerRef={triggerRef}
          onClose={() => undefined}
        />
      </>,
    );
    await waitFor(() => expect(screen.getByText("Trusted")).toBeVisible());
    expect(screen.getByText(/\(EXPIRED\)/)).toBeVisible();
    expect(screen.queryByText("Trust expired")).toBeNull();
  });

  it("keeps certificate expiry visible before explicit approval and in the HTTPS information bar", () => {
    const dialog = render(
      <TrustWarningDialog
        type="https"
        host={host}
        port={443}
        reason="first-use"
        receivedIdentity={expired}
        onAccept={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(screen.getByText(/\(EXPIRED\)/)).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /Remember and trust/ }),
    ).not.toBeChecked();
    dialog.unmount();
    render(
      <SecurityInfoBar
        mgr={
          {
            isSecure: true,
            certIdentity: expired,
            session: { hostname: host },
            hasAuth: false,
          } as WebBrowserMgr
        }
      />,
    );
    expect(screen.getByText("Certificate expired")).toBeVisible();
  });
});
