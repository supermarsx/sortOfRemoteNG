import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Exercise the exact versioned function prefix in the native compatibility
// rule, not a reimplementation of Synology's default host/port handling.
const native = readFileSync(
  "src-tauri/crates/sorng-protocols/src/http_response.rs",
  "utf8",
);
function nativeConstant(name: string) {
  return native.match(new RegExp(`const ${name}: &str = r#"(.*?)"#;`, "s"))![1];
}
const head = nativeConstant("QUICKCONNECT_REDIRECT_HEAD");
const source = "https://nas.fr3.quickconnect.to";
const local = "http://p0123456789abcdef.localhost:54362";
const bind = (code: string, origin = source) =>
  code
    .split("__SORNG_QUICKCONNECT_SOURCE_ORIGIN__")
    .join(JSON.stringify(origin));
const navigation = readFileSync(
  "src-tauri/crates/sorng-protocols/src/quickconnect_navigation_client.js",
  "utf8",
);
const mapped = (raw: string) =>
  runInNewContext(
    `${bind(navigation)};sorngQuickConnectNavigation(raw)`,
    {
      URL,
      raw,
      window: { location: new URL(`${local}/?unused=1`) },
    },
    { timeout: 100 },
  );
const evaluate = (
  prefix: string,
  href: string,
  input: Record<string, unknown> = {},
) =>
  runInNewContext(
    `({${prefix};return new URL(n+'//'+o+(f===''?'':':'+f)+'/portal/error.html');}}).value(input).href`,
    { URL, window: { location: new URL(href) }, input },
    { timeout: 100 },
  );

describe("QuickConnect versioned redirect URL compatibility", () => {
  const fixed = bind(nativeConstant("QUICKCONNECT_REDIRECT_DEFAULTS"));
  it("reproduces the reported Invalid URL on a nondefault local proxy port", () => {
    expect(() =>
      evaluate(head, "http://p0123456789abcdef.localhost:54362/"),
    ).toThrow("Invalid URL");
  });
  it.each([
    "http://p0123456789abcdef.localhost:54362/",
    "http://p0123456789abcdef.localhost:81/",
    "https://nas.quickconnect.to/",
    "https://nas.quickconnect.to:5001/",
  ])("uses upstream defaults, never the ephemeral proxy port: %s", (href) => {
    expect(evaluate(fixed, href)).toBe(`${source}/portal/error.html`);
    expect(mapped(evaluate(fixed, href))).toBe(`${local}/portal/error.html`);
  });
  it("preserves an explicitly supplied destination and port", () => {
    expect(
      evaluate(fixed, "http://p0123456789abcdef.localhost:54362/", {
        protocol: "https:",
        ip: "nas.example",
        port: "5001",
      }),
    ).toBe("https://nas.example:5001/portal/error.html");
  });
  it("uses the upstream port when the actual NAS origin has a custom port", () => {
    const withPort = bind(
      nativeConstant("QUICKCONNECT_REDIRECT_DEFAULTS"),
      `${source}:5001`,
    );
    expect(evaluate(withPort, local)).toBe(`${source}:5001/portal/error.html`);
  });
  it("projects source detection without changing the browser Location", () => {
    const location = new URL(
      `${local}/nas?product=dsm&a=%20&b=+&__sorng_navigation_v1=internal#login`,
    );
    const projected = runInNewContext(
      `var ${bind(nativeConstant("QUICKCONNECT_SOURCE_PROJECTION"))}{};i.href`,
      {
        URL,
        window: { location },
      },
      { timeout: 100 },
    );
    expect(projected).toBe(`${source}/nas?product=dsm&a=%20&b=+#login`);
    expect(location.origin).toBe(local);
  });
  it("keeps same-origin paths, query and fragments on the protected proxy", () => {
    expect(mapped(`${source}/webman?step=2#login`)).toBe(
      `${local}/webman?step=2#login`,
    );
  });
  it.each([
    "https://nas.quickconnect.to/",
    "https://nas.fr4.quickconnect.to/webman?step=2#login",
    "http://nas.fr4.quickconnect.to/",
    "https://user:secret@nas.fr3.quickconnect.to/",
    "javascript:alert(1)",
  ])("never directly navigates to an unreviewed destination: %s", (raw) => {
    const result = new URL(mapped(raw));
    expect(result.origin).toBe(local);
    expect(result.pathname).toBe("/__sortofremoteng_quickconnect_redirect_v1");
    expect([...result.searchParams.keys()]).toEqual(["destination"]);
    expect(result.searchParams.get("destination")).toBe(new URL(raw).href);
  });
});
