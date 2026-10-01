import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Mirror native assembly; staged-client constants are opt-in for fixtures. */
export function loadAutologinClient(
  repoRoot = process.cwd(),
  stagedClients: readonly string[] = [],
): string {
  const base = resolve(repoRoot, "src-tauri/crates/sorng-protocols/src");
  const asset = readFileSync(resolve(base, "autologin_asset.rs"), "utf8");
  const modules = /pub const AUTOLOGIN_MODULES_JS: &str = ([\s\S]*?);/.exec(
    asset,
  )?.[1];
  if (!modules) throw new Error("Native auto-login module manifest is missing");
  const parts = [...modules.matchAll(/include_str!\("([^"]+)"\)/g)].map(
    (match) => readFileSync(resolve(base, match[1]), "utf8"),
  );
  if (!parts.length)
    throw new Error("Native auto-login module manifest is empty");
  const client = readFileSync(resolve(base, "autologin_client.js"), "utf8");
  const marker = "/*__SORNG_AUTOLOGIN_MODULES__*/";
  if (client.split(marker).length !== 2)
    throw new Error("Native auto-login assembly marker is invalid");
  const stagedManifest = new Map(
    [
      ...asset.matchAll(
        /pub const ([A-Z_]+_CLIENT_JS): &str = include_str!\("([^"]+)"\);/g,
      ),
    ].map((match) => [match[1], match[2]] as const),
  );
  const staged = stagedClients.map((name) => {
    const path = stagedManifest.get(name);
    if (!path || name === "AUTOLOGIN_CLIENT_JS")
      throw new Error(`Unknown staged auto-login client: ${name}`);
    return readFileSync(resolve(base, path), "utf8");
  });
  return staged.join("") + client.replace(marker, () => parts.join(""));
}
