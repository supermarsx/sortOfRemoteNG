import { createRoot } from "react-dom/client";
import {
  TrustIdentityImportDialog,
  type TrustIdentityImportReview,
} from "../../src/components/security/TrustIdentityImportDialog";
import { refused } from "./boundary";
import "../../app/globals.css";

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
createRoot(document.getElementById("root")!).render(
  <>
    <p className="p-3 text-xs">
      Actual application component · synthetic trust identities
    </p>
    <TrustIdentityImportDialog
      review={review}
      busy={false}
      connectionName={() => "Operations dashboard"}
      onClose={() => {}}
      onConfirm={() => {}}
    />
  </>,
);
