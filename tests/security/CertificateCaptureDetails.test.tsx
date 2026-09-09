import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CertificateCaptureDetails } from "../../src/components/security/CertificateCaptureDetails";
import { validateCertificateInspection } from "../../src/utils/security/certificateInspection";
import type { NativeTlsCertificateInfo } from "../../src/types/security/certificateInspection";
import { certificateInfoFixture } from "../fixtures/certificateInspection";

async function expand(label: string, parent: HTMLElement = document.body) {
  const summary = within(parent).getByText(label);
  fireEvent.click(summary);
  const details = summary.closest("details")!;
  await waitFor(() => expect(details.open).toBe(true));
  await waitFor(() => expect(details.children.length).toBeGreaterThan(1));
  return details;
}
describe("ephemeral peer certificate details", () => {
  it("exposes full captured DN, algorithms, SANs, raw material, extensions and peer entries progressively", async () => {
    render(
      <CertificateCaptureDetails
        inspection={{
          host: "dashboard.example.test",
          port: 443,
          generation: 1,
          certificate: certificateInfoFixture,
        }}
      />,
    );
    expect(
      screen.getByText(/not a verified certification path/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("13 bytes captured")).toHaveAttribute(
      "data-tooltip",
      "13 bytes captured",
    );
    expect(screen.getByLabelText("13 bytes captured")).toHaveTextContent(
      "13 B",
    );
    expect(
      screen.queryByText("sha256WithRSAEncryption"),
    ).not.toBeInTheDocument();
    const leaf = await expand("Observed leaf certificate — full details");
    expect(
      within(leaf).getByText(certificateInfoFixture.subject!),
    ).toBeInTheDocument();
    expect(
      within(leaf).getByText("sha256WithRSAEncryption"),
    ).toBeInTheDocument();
    expect(within(leaf).getByText("de".repeat(48))).toBeInTheDocument();
    await expand("Subject distinguished-name attributes (1)", leaf);
    expect(within(leaf).getByText("commonName · RDN 0")).toBeInTheDocument();
    const san = await expand("Subject alternative names (2)", leaf);
    expect(within(san).getByText("192.0.2.10")).toBeInTheDocument();
    const key = await expand("Public key", leaf);
    expect(within(key).getByText("2048")).toBeInTheDocument();
    expect(within(key).getByText("cd".repeat(32))).toBeInTheDocument();
    const extensions = await expand("Certificate extensions (1)", leaf);
    expect(within(extensions).getByText("CA: false")).toBeInTheDocument();
    await expand("Raw certificate PEM", leaf);
    expect(within(leaf).getByText(/SYNTHETIC-ONLY/)).toBeInTheDocument();
    await expand("Raw certificate DER (base64)", leaf);
    expect(within(leaf).getByText("U1lOVEhFVElDLURFUg==")).toBeInTheDocument();
    const chain = await expand("Peer-presented chain (1)");
    await expand("Leaf · CN=dashboard.example.test", chain);
    expect(within(chain).getByText("Full issuer DN")).toBeInTheDocument();
  });
  it("retains raw peer material with parser warnings without inventing absent metadata", async () => {
    const certificate = {
      ...certificateInfoFixture,
      details: {
        ...certificateInfoFixture.details!,
        serial: null,
        public_key: null,
        parse_error: "Unsupported metadata; inspect raw DER",
      },
      warnings: ["Peer metadata could not be completely parsed"],
    };
    render(
      <CertificateCaptureDetails
        inspection={{
          host: "fixture.test",
          port: 443,
          generation: 1,
          certificate,
        }}
      />,
    );
    expect(
      screen.getByText("Peer metadata could not be completely parsed"),
    ).toBeInTheDocument();
    const leaf = await expand("Observed leaf certificate — full details");
    expect(within(leaf).getByText(/Unsupported metadata/)).toBeInTheDocument();
    const key = await expand("Public key", leaf);
    expect(
      within(key).getByText("Public-key metadata was not captured."),
    ).toBeInTheDocument();
    await expand("Raw certificate PEM", leaf);
    expect(within(leaf).getByText(/SYNTHETIC-ONLY/)).toBeInTheDocument();
  });
  it("keeps long peer names concise in summaries while exposing the complete DN when expanded", async () => {
    const subject = "CN=" + "peer".repeat(500);
    render(
      <CertificateCaptureDetails
        inspection={{
          host: "fixture.test",
          port: 443,
          generation: 1,
          certificate: {
            ...certificateInfoFixture,
            chain: [{ ...certificateInfoFixture.chain![0], subject }],
          },
        }}
      />,
    );
    const chain = await expand("Peer-presented chain (1)");
    const summary = within(chain).getByTitle(subject);
    expect(summary.textContent!.length).toBeLessThan(140);
    expect(within(chain).queryByText(subject)).not.toBeInTheDocument();
    await expand(summary.textContent!, chain);
    expect(within(chain).getByText(subject)).toBeInTheDocument();
  });
  it("validates the current rich DTO and accepts older summary-only responses", () => {
    expect(validateCertificateInspection(certificateInfoFixture)).toBe(
      certificateInfoFixture,
    );
    expect(
      validateCertificateInspection({ fingerprint: "AA", chain: null }),
    ).toEqual({ fingerprint: "AA", chain: null });
  });
  it("rejects contradictory rich leaf/chain identities even if capture metadata is omitted", () => {
    const different = "cd".repeat(32);
    const partial = {
      ...certificateInfoFixture,
      capture: undefined,
      chain: [
        {
          ...certificateInfoFixture.chain![0],
          fingerprint: different,
          details: {
            ...certificateInfoFixture.details!,
            fingerprints: {
              ...certificateInfoFixture.details!.fingerprints,
              sha256: different,
            },
          },
        },
      ],
    };
    expect(() => validateCertificateInspection(partial)).toThrow(
      "Malformed bounded certificate inspection details",
    );
  });
  it.each([
    {
      ...certificateInfoFixture,
      details: { ...certificateInfoFixture.details, extensions: [null] },
    },
    {
      ...certificateInfoFixture,
      capture: { ...certificateInfoFixture.capture, certificate_count: 2 },
    },
    {
      ...certificateInfoFixture,
      details: {
        ...certificateInfoFixture.details,
        subject_attributes: new Array(129).fill({}),
      },
    },
    { ...certificateInfoFixture, warnings: ["x".repeat(4097)] },
    { ...certificateInfoFixture, fingerprint: "cd".repeat(32) },
    {
      ...certificateInfoFixture,
      details: {
        ...certificateInfoFixture.details,
        fingerprints: {
          ...certificateInfoFixture.details!.fingerprints,
          sha384: "not-a-digest",
        },
      },
    },
    {
      ...certificateInfoFixture,
      chain: [
        { ...certificateInfoFixture.chain![0], fingerprint: "cd".repeat(32) },
      ],
    },
  ])(
    "rejects malformed or oversized rich captures without partial success",
    (value) => {
      expect(() =>
        validateCertificateInspection(value as NativeTlsCertificateInfo),
      ).toThrow("Malformed bounded certificate inspection details");
    },
  );
});
