import { createRoot } from "react-dom/client";
import { useRef } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import english from "../../src/i18n/locales/en-US.json";
import { CertificateInfoPopup } from "../../src/components/security/CertificateInfoPopup";
import { certificateInfoFixture } from "../../tests/fixtures/certificateInspection";
import {
  TrustIdentityScopeDialog,
  type TrustScopeReview,
} from "../../src/components/security/TrustIdentityScopeDialog";
import type { Connection } from "../../src/types/connection/connection";
import {
  TrustIdentityImportDialog,
  type TrustIdentityImportReview,
} from "../../src/components/security/TrustIdentityImportDialog";
import { refused } from "./boundary";
import "../../app/globals.css";
await i18n.use(initReactI18next).init({
  lng: "en-US",
  fallbackLng: "en-US",
  resources: { "en-US": { translation: english } },
  interpolation: { escapeValue: false },
});

const review: TrustIdentityImportReview = {
  databaseId: "synthetic-database",
  databaseName: "Operations · demonstration database",
  document: {
    version: 1,
    records: Array.from({ length: 140 }, (_, index) => ({
      host:
        index % 2
          ? `@sorng/connection/v1/demo-dashboard/dashboard-${index}.example.test/443`
          : `server-${index}.example.test:443`,
      record_type: "https",
      identity: {
        fingerprint: `SHA256:${"A1:B2:C3:D4:".repeat(7)}${index.toString().padStart(2, "0")}`,
      },
      user_approved: index % 3 === 0,
      revoked: index === 3,
      trust_expires: "2027-09-01T00:00:00Z",
    })),
  },
  expectedRecords: [
    {
      host: "server-0.example.test:443",
      record_type: "https",
      identity: { fingerprint: "SHA256:PREVIOUS-SYNTHETIC-FINGERPRINT" },
      user_approved: true,
      revoked: true,
    },
  ],
  warnings: [
    "Synthetic review only. No identities will be imported and no saved database is accessed.",
  ],
};
Object.assign(window, { __TRUST_DEMO__: { refused } });
const scopeConnections: Connection[] = [
  {
    id: "demo-dashboard",
    name: "Operations dashboard",
    hostname: "dashboard.example.test",
    protocol: "https",
    port: 443,
    isGroup: false,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
  },
  {
    id: "demo-shell",
    name: "Maintenance shell",
    hostname: "shell.example.test",
    protocol: "ssh",
    port: 22,
    isGroup: false,
    createdAt: "2026-09-09",
    updatedAt: "2026-09-09",
  },
];
const scopeReview: TrustScopeReview = {
  databaseId: "synthetic-database",
  databaseName: "Operations · demonstration database",
  rows: Array.from({ length: 3 }, (_, index) => ({
    id: `scope-${index}`,
    connectionId: index === 2 ? undefined : "demo-dashboard",
    record: {
      host: `dashboard-${index}.example.test:443`,
      type: "https",
      userApproved: index !== 1,
      revoked: index === 1,
      identity: {
        fingerprint: `SHA256:${"A1:B2:C3:D4:".repeat(7)}00:11:22:33`,
        firstSeen: "2026-09-09",
        lastSeen: "2026-09-09",
      },
      scopeDecision: {
        userApproved: index !== 1,
        revoked: index === 1,
        trustExpires: "2027-09-01T00:00:00Z",
        hostPolicy: null,
        hostPolicyConfig: null,
      },
    },
  })),
};
export function CertificateDemo() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const certificate = {
    ...certificateInfoFixture,
    chain: [
      ...certificateInfoFixture.chain!,
      {
        ...certificateInfoFixture.chain![0],
        subject: "CN=" + "LongPeerControlledName".repeat(70),
      },
    ],
    capture: { ...certificateInfoFixture.capture!, certificate_count: 2 },
  };
  return (
    <div className="p-4">
      <button ref={triggerRef}>Certificate · synthetic capture</button>
      <CertificateInfoPopup
        type="https"
        host="dashboard.example.test"
        port={443}
        triggerRef={triggerRef}
        onClose={() => {}}
        currentIdentity={{
          fingerprint: certificate.fingerprint,
          subject: certificate.subject!,
          issuer: certificate.issuer!,
          firstSeen: "2026-09-09",
          lastSeen: "2026-09-09",
        }}
        inspection={{
          host: "dashboard.example.test",
          port: 443,
          generation: 1,
          certificate,
        }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <>
    <p className="p-3 text-xs">
      Actual application component · synthetic trust identities
    </p>
    {new URLSearchParams(location.search).get("view") === "certificate" ? (
      <CertificateDemo />
    ) : new URLSearchParams(location.search).get("view") === "scope" ? (
      <TrustIdentityScopeDialog
        review={scopeReview}
        connections={scopeConnections}
        busy={false}
        onClose={() => {}}
        onConfirm={() => {
          refused.push("Unexpected scope confirmation in visual fixture");
        }}
      />
    ) : (
      <TrustIdentityImportDialog
        review={review}
        busy={false}
        connectionName={() => "Operations dashboard"}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    )}
  </>,
);
