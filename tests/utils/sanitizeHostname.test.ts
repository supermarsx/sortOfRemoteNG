/**
 * Unit tests for the hostname sanitiser (P8).
 *
 * The sanitiser exists because a user who pastes `http://example.com`
 * into the Hostname/IP field used to end up with a connection whose
 * `buildTargetUrl` produced `http://http://example.com/`. The cases
 * below mirror the real shapes users / importers reach the field
 * with: bare hosts, URL paste, URL paste with port, paste with path,
 * IPv6 literals, leading whitespace, and accidental schemes from
 * unrelated protocols (`ssh://`, `mailto:` is intentionally NOT in
 * the strip list because it has no `://`).
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeHostname,
  stripSchemePrefix,
} from "../../src/utils/connection/sanitizeHostname";

describe("sanitizeHostname", () => {
  it("leaves a bare hostname untouched", () => {
    const r = sanitizeHostname("example.com");
    expect(r.hostname).toBe("example.com");
    expect(r.stripped).toBe(false);
    expect(r.scheme).toBeUndefined();
    expect(r.port).toBeUndefined();
    expect(r.path).toBeUndefined();
  });

  it("leaves an IPv4 address untouched", () => {
    expect(sanitizeHostname("192.168.1.100").hostname).toBe("192.168.1.100");
  });

  it("leaves a bare host:port untouched (no scheme present)", () => {
    // Without a scheme we don't second-guess the user — `host:port`
    // is a valid hostname-field shape in some configs.
    const r = sanitizeHostname("example.com:8080");
    expect(r.hostname).toBe("example.com:8080");
    expect(r.stripped).toBe(false);
    expect(r.port).toBeUndefined();
  });

  it("strips http:// prefix", () => {
    const r = sanitizeHostname("http://example.com");
    expect(r.hostname).toBe("example.com");
    expect(r.stripped).toBe(true);
    expect(r.scheme).toBe("http");
  });

  it("strips https:// prefix and extracts port", () => {
    const r = sanitizeHostname("https://example.com:8443");
    expect(r.hostname).toBe("example.com");
    expect(r.stripped).toBe(true);
    expect(r.scheme).toBe("https");
    expect(r.port).toBe(8443);
  });

  it("strips ssh:// prefix", () => {
    const r = sanitizeHostname("ssh://example.com");
    expect(r.hostname).toBe("example.com");
    expect(r.scheme).toBe("ssh");
  });

  it("strips rdp://, vnc://, telnet://, ftp://", () => {
    expect(sanitizeHostname("rdp://example").hostname).toBe("example");
    expect(sanitizeHostname("vnc://example").hostname).toBe("example");
    expect(sanitizeHostname("telnet://example").hostname).toBe("example");
    expect(sanitizeHostname("ftp://example").hostname).toBe("example");
  });

  it("strips every direct protocol scheme that previously escaped sanitization", () => {
    for (const scheme of [
      "ard",
      "serial",
      "raw",
      "raw-tcp",
      "raw-udp",
      "winrm",
      "wsman",
      "powershell",
      "anydesk",
      "rustdesk",
    ]) {
      expect(sanitizeHostname(`${scheme}://example`).hostname, scheme).toBe(
        "example",
      );
    }
  });

  it("sanitizes schemes on imported management identities", () => {
    for (const scheme of [
      "gcp",
      "azure",
      "ibm-csp",
      "digital-ocean",
      "heroku",
      "scaleway",
      "linode",
      "ovhcloud",
      "ilo",
      "lenovo",
      "supermicro",
    ]) {
      expect(sanitizeHostname(`${scheme}://example`).hostname, scheme).toBe(
        "example",
      );
    }
  });

  it("is case-insensitive on the scheme", () => {
    const r = sanitizeHostname("HTTPS://Example.COM");
    expect(r.hostname).toBe("Example.COM"); // host case preserved
    expect(r.scheme).toBe("https"); // scheme normalised to lower
  });

  it("trims leading and trailing whitespace", () => {
    const r = sanitizeHostname("  https://example.com  ");
    expect(r.hostname).toBe("example.com");
    expect(r.stripped).toBe(true);
  });

  it("discards path / query / fragment from a URL paste", () => {
    const r = sanitizeHostname("https://example.com:8443/admin?x=1#tab");
    expect(r.hostname).toBe("example.com");
    expect(r.port).toBe(8443);
    expect(r.path).toBe("/admin?x=1#tab");
  });

  it("drops user-info from a URL paste", () => {
    // `alice@host:port/path` — auth fields are separate; the host
    // field should NOT carry credentials.
    const r = sanitizeHostname(
      "https://alice:secret@example.com:443/dashboard",
    );
    expect(r.hostname).toBe("example.com");
    expect(r.port).toBe(443);
    expect(r.path).toBe("/dashboard");
  });

  it("handles IPv6 literal with explicit port", () => {
    const r = sanitizeHostname("http://[::1]:8080");
    expect(r.hostname).toBe("::1");
    expect(r.port).toBe(8080);
  });

  it("handles IPv6 literal without port", () => {
    const r = sanitizeHostname("http://[2001:db8::1]");
    expect(r.hostname).toBe("2001:db8::1");
    expect(r.port).toBeUndefined();
  });

  it("rejects an out-of-range port (>65535) by ignoring it", () => {
    const r = sanitizeHostname("http://example.com:99999");
    // No valid port extracted; the colon-port stays on the host
    // because we can't safely promote it.
    expect(r.port).toBeUndefined();
    // Defensive — at minimum the scheme is gone.
    expect(r.stripped).toBe(true);
  });

  it("returns empty for empty input", () => {
    const r = sanitizeHostname("");
    expect(r.hostname).toBe("");
    expect(r.stripped).toBe(false);
  });

  it("is idempotent — running twice yields the same shape", () => {
    const once = sanitizeHostname("https://example.com:8443/x");
    const twice = sanitizeHostname(once.hostname);
    expect(twice.hostname).toBe(once.hostname);
    expect(twice.stripped).toBe(false);
  });

  it("doesn't strip an unrelated scheme it doesn't recognise", () => {
    // `chrome://settings` should pass through — we don't know what
    // to do with it.
    const r = sanitizeHostname("chrome://settings");
    expect(r.hostname).toBe("chrome://settings");
    expect(r.stripped).toBe(false);
  });
});

describe("stripSchemePrefix", () => {
  it("returns only the cleaned hostname", () => {
    expect(stripSchemePrefix("http://example.com")).toBe("example.com");
    expect(stripSchemePrefix("https://example.com:443/admin")).toBe(
      "example.com",
    );
    expect(stripSchemePrefix("example.com")).toBe("example.com");
    expect(stripSchemePrefix("")).toBe("");
  });

  it("is the canonical defensive call for URL-builders", () => {
    // This is the exact shape the buildTargetUrl bug used to hit.
    const hostname = stripSchemePrefix("http://example.com");
    expect(`http://${hostname}/`).toBe("http://example.com/");
  });
});
