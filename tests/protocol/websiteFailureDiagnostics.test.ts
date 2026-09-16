import { describe, expect, it } from "vitest";

import {
  websiteDiagnosticsAddress,
  websiteFailureDiagnosticsText,
  type WebsiteFailureDiagnosticsInput,
} from "../../src/utils/protocol/websiteFailureDiagnostics";

/** Values that must never survive into a copied summary. */
const SECRETS = {
  username: "admin",
  password: "hunter2-secret",
  sessionId: "ZGV2aWNlLXNlc3Npb24tdG9rZW4",
  cookie: "SYNOTOKEN=abc123",
};

/** The builder never reads the upstream body, so the failure's `detail` (which
 *  carries it, cookies and all) is deliberately absent from its input type. */
const upstreamFailure: WebsiteFailureDiagnosticsInput = {
  kind: "http_status",
  status: 404,
  title: "Not found",
  url: "https://10.15.27.1/packages/backup/backup.php",
  upstream: {
    method: "GET",
    reasonPhrase: "Not Found",
    server: "nginx",
    contentType: "text/html",
    bodyBytes: 150,
    elapsedMs: 12,
  },
};

const context = {
  connectionId: "8d2f1b6e-4c3a-4f2b-9d10-2f4a6c8e0b11",
  connectionName: "Backup NAS",
  appVersion: "26.45",
};

describe("website failure diagnostics address", () => {
  it("keeps the origin and path but drops userinfo, query values and the fragment", () => {
    const parsed = websiteDiagnosticsAddress(
      `https://${SECRETS.username}:${SECRETS.password}@10.15.27.1/webman/index.cgi?_sid=${SECRETS.sessionId}&lang=enu#/signin`,
    );
    expect(parsed).toEqual({
      address: "https://10.15.27.1/webman/index.cgi",
      queryKeys: ["_sid", "lang"],
    });
  });

  it("rejects a non-HTTP address rather than copying it", () => {
    expect(websiteDiagnosticsAddress("javascript:alert(1)")).toBeNull();
    expect(websiteDiagnosticsAddress("file:///c:/secrets.txt")).toBeNull();
    expect(websiteDiagnosticsAddress("not a url")).toBeNull();
  });
});

describe("website failure diagnostics text", () => {
  it("reports every upstream fact the page shows", () => {
    const text = websiteFailureDiagnosticsText(upstreamFailure, context);
    expect(text.split("\n")).toEqual([
      "Website error diagnostics",
      "Reported as: Not found (http_status)",
      "Result: HTTP 404 Not Found",
      "Address: https://10.15.27.1/packages/backup/backup.php",
      "Request method: GET",
      "Upstream server header: nginx",
      "Response content type: text/html",
      "Response body size: 150 bytes",
      "Upstream request duration: 12 ms",
      "Connection: Backup NAS (id 8d2f1b6e-4c3a-4f2b-9d10-2f4a6c8e0b11)",
      "App version: 26.45",
      "No credentials, cookies, authorization headers, query values or response body are included.",
    ]);
  });

  it("never copies credentials, tokens, cookies or the response body", () => {
    // Passed the whole failure — including the `detail` that carries the
    // upstream body — the builder must still copy only its own closed fields.
    const text = websiteFailureDiagnosticsText(
      {
        ...upstreamFailure,
        url: `https://${SECRETS.username}:${SECRETS.password}@10.15.27.1/cgi?_sid=${SECRETS.sessionId}`,
        reason: "The page or resource doesn't exist at this address.",
        detail: `<html><head><title>404 Not Found</title></head><body>${SECRETS.cookie}</body></html>`,
      } as WebsiteFailureDiagnosticsInput,
      context,
    );
    for (const secret of Object.values(SECRETS))
      expect(text).not.toContain(secret);
    expect(text).not.toContain("404 Not Found</title>");
    expect(text).toContain("Address: https://10.15.27.1/cgi");
    // The key name survives so the reader knows a session id was in play.
    expect(text).toContain("Query keys (values omitted): _sid");
  });

  it("states plainly when no response was ever received", () => {
    const text = websiteFailureDiagnosticsText(
      {
        ...upstreamFailure,
        kind: "host_unreachable",
        status: null,
        title: "Can't reach 10.15.27.1:443",
        upstream: undefined,
        timeline: { failedAfterMs: 10_040 },
      },
      context,
    );
    expect(text).toContain("Result: no HTTP response");
    expect(text).toContain(
      "Upstream response: none — the request failed before a response was received",
    );
    expect(text).toContain("Attempt failed after: 10.0 s");
    expect(text).not.toContain("Request method");
  });

  it("marks missing upstream headers and an unsaved connection instead of guessing", () => {
    const text = websiteFailureDiagnosticsText(
      {
        ...upstreamFailure,
        status: 500,
        upstream: {
          ...upstreamFailure.upstream!,
          reasonPhrase: "Internal Server Error",
          server: null,
          contentType: null,
          bodyBytes: 0,
        },
      },
      { appVersion: "26.45" },
    );
    expect(text).toContain("Result: HTTP 500 Internal Server Error");
    expect(text).toContain("Upstream server header: not reported");
    expect(text).toContain("Response content type: not reported");
    expect(text).toContain("Response body size: 0 bytes");
    expect(text).toContain("Connection: unsaved");
  });

  it("keeps a hostile title, name or header on one line and bounded", () => {
    const text = websiteFailureDiagnosticsText(
      {
        ...upstreamFailure,
        title: "Not found\nApp version: 99.99",
        upstream: { ...upstreamFailure.upstream!, server: "a".repeat(400) },
      },
      { ...context, connectionName: "NAS\nResult: HTTP 200 OK" },
    );
    const lines = text.split("\n");
    expect(
      lines.filter((line) => line.startsWith("App version:")),
    ).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("Result:"))).toHaveLength(1);
    expect(text).toContain("Reported as: Not foundApp version: 99.99");
    expect(text).toContain(`Upstream server header: ${"a".repeat(128)}`);
    expect(text).not.toContain("a".repeat(129));
  });
});
