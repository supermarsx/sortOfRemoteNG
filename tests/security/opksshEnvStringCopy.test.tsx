/**
 * The OPKSSH providers tab copies `OPKSSH_PROVIDERS="..."` with the ordinary
 * clipboard. That is right only while the string holds public values: alias,
 * issuer, client id and scopes, with the client-secret slot empty. This suite
 * pins both halves of that: the tab copies the backend's string and nothing of
 * its own, and the backend builds the string from the redacted configuration.
 * If either stops being true, this copy has to move to the secure clipboard.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvidersTab } from "../../src/components/ssh/opkssh/ProvidersTab";
import type { OpksshMgr } from "../../src/components/ssh/opkssh/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Synthetic. The secret is what a regression would have to leak.
const SECRET = "OIDC-CLIENT-SECRET-SYNTHETIC";
const BUILT =
  "corp,https://issuer.example.test,client-id,,openid profile;lab,https://lab.example.test,lab-client,,";

/** The client-secret slot of every provider in an `OPKSSH_PROVIDERS` value. */
const secretSlots = (assignment: string) =>
  assignment
    .replace(/^OPKSSH_PROVIDERS="|"$/g, "")
    .split(";")
    .map((provider) => provider.split(",")[3]);

describe("OPKSSH providers tab: copying the environment string", () => {
  let webWrite: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    // A fake: the real clipboard is never read or written.
    webWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: webWrite },
    });
  });
  afterEach(() => cleanup());

  async function copyBuiltString() {
    const held: Record<string, unknown> = {
      // A configuration that carries a secret, as a regression might.
      clientConfig: {
        configPath: "~/.opk/config.yml",
        defaultProvider: "corp",
        providers: [
          {
            alias: "corp",
            issuer: "https://issuer.example.test",
            clientId: "client-id",
            clientSecret: SECRET,
            scopes: "openid profile",
          },
        ],
      },
      wellKnownProviders: [],
      buildEnvString: vi.fn().mockResolvedValue(BUILT),
    };
    const mgr = new Proxy(held, {
      get: (target, key: string) => (key in target ? target[key] : vi.fn()),
    }) as unknown as OpksshMgr;
    render(<ProvidersTab mgr={mgr} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByTitle("Copy"));
    await vi.waitFor(() => expect(webWrite).toHaveBeenCalledOnce());
    return webWrite.mock.calls[0][0] as string;
  }

  it("copies exactly the string the backend built, as an assignment", async () => {
    expect(await copyBuiltString()).toBe(`OPKSSH_PROVIDERS="${BUILT}"`);
  });

  it("adds nothing from the configuration it holds: every secret slot stays empty", async () => {
    const copied = await copyBuiltString();
    expect(copied).not.toContain(SECRET);
    expect(secretSlots(copied)).toEqual(["", ""]);
  });
});

/** Reads a Rust source of the OPKSSH crate; line endings do not matter. */
const rust = (file: string) =>
  readFileSync(`src-tauri/crates/sorng-opkssh/src/${file}`, "utf8").replace(
    /\r\n/g,
    "\n",
  );

/**
 * Why the string the backend builds could carry a client secret, judged from
 * the crate's sources; empty when it cannot. The crate's own test
 * `update_client_config_redacts_cached_transport_and_preserves_secret_on_disk`
 * checks the same outcome at run time.
 */
function secretPaths(sources: {
  service: string;
  types: string;
  providers: string;
}): string[] {
  const { service, types, providers } = sources;
  const found: string[] = [];

  // 1. The string is built from the service's cached configuration only.
  const build = service.slice(
    service.indexOf("pub fn build_env_providers_string(&self)"),
  );
  const body = build.slice(0, build.indexOf("\n    }"));
  if (
    !service.includes("pub fn build_env_providers_string(&self)") ||
    !/self\s*\.client_config\s*\.as_ref\(\)/.test(body) ||
    !body.includes("providers::build_env_providers_string(&c.providers)")
  )
    found.push("the string is not built from the cached configuration");

  // 2. Every value stored in that cache has been through the redaction.
  const stored = [...service.matchAll(/self\.client_config\s*=\s*([^;]+);/g)];
  if (!stored.length) found.push("no assignment of the cache was found");
  for (const [, value] of stored) {
    const name = /^Some\((\w+)\.clone\(\)\)$/.exec(value.trim())?.[1];
    const redacted =
      value.includes("providers::redact_client_config_for_transport(") ||
      (name !== undefined &&
        service.includes(
          `let ${name} = providers::redact_client_config_for_transport(`,
        ));
    if (!redacted) found.push(`the cache is set without redaction: ${value}`);
  }
  if (
    /client_config\s*\.\s*(as_mut|get_or_insert|insert|replace)\b/.test(service)
  )
    found.push("the cache is changed in place");

  // 3. The redaction removes each provider's client secret.
  if (
    !/pub fn redact_client_config_for_transport\([^)]*\)\s*->\s*OpksshClientConfig\s*\{\s*config\.redacted_for_transport\(\)\s*\}/.test(
      providers,
    )
  )
    found.push("the redaction entry point does not redact");
  if (!types.includes(".map(CustomProvider::redacted_for_transport)"))
    found.push("the redaction does not cover every provider");
  const provider = types.slice(
    types.indexOf("pub fn redacted_for_transport(&self) -> Self {"),
  );
  if (
    !provider
      .slice(0, provider.indexOf("\n    }"))
      .includes("provider.client_secret = None;")
  )
    found.push("a redacted provider keeps its client secret");

  return found;
}

describe("OPKSSH environment string: built without client secrets", () => {
  const sources = {
    service: rust("service.rs"),
    types: rust("types.rs"),
    providers: rust("providers.rs"),
  };
  it("finds no way for a client secret into the string in the current sources", () => {
    expect(secretPaths(sources)).toEqual([]);
  });

  it.each<[string, keyof typeof sources, string, string]>([
    [
      "the cache stored unredacted after an update",
      "service",
      "Some(providers::redact_client_config_for_transport(&persisted))",
      "Some(persisted.clone())",
    ],
    [
      "the cache stored unredacted after a refresh",
      "service",
      "let transport = providers::redact_client_config_for_transport(&config);",
      "let transport = config.clone();",
    ],
    [
      "the string built from something other than the cache",
      "service",
      "        self.client_config\n            .as_ref()\n            .map(|c| providers::build_env_providers_string(&c.providers))",
      "        Some(providers::build_env_providers_string(&self.disk_providers))",
    ],
    [
      "the cache edited in place",
      "service",
      "pub fn get_client_config(&self)",
      "pub fn set_secret(&mut self) { self.client_config.as_mut(); }\n    pub fn get_client_config(&self)",
    ],
    [
      "a redaction that keeps the provider's secret",
      "types",
      "        provider.client_secret = None;\n",
      "",
    ],
    [
      "a redaction that skips the providers",
      "types",
      ".map(CustomProvider::redacted_for_transport)",
      ".cloned()",
    ],
    [
      "an entry point that does not redact",
      "providers",
      "    config.redacted_for_transport()\n}",
      "    config.clone()\n}",
    ],
  ])("would notice %s", (_change, file, from, to) => {
    // The change is made to a copy in memory; `from` must still exist, so a
    // reshaped source fails here instead of passing unnoticed.
    expect(sources[file]).toContain(from);
    const altered = { ...sources, [file]: sources[file].replace(from, to) };
    expect(secretPaths(altered)).not.toEqual([]);
  });
});
