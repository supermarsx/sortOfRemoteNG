import { defaultScriptCatalog } from "../../../data/defaultScriptCatalog";
import type { AutomationProvenance } from "../../../types/recording/automationLibrary";
import type { ManagedScript } from "./shared";

// IDs/timestamps may change on an explicit copy. Every content/compatibility field
// must still match; arbitrary remote metadata can never grant this badge.
const identity = (script: ManagedScript) =>
  JSON.stringify({
    name: script.name,
    description: script.description,
    script: script.script,
    language: script.language,
    category: script.category,
    osTags: [...(script.osTags ?? [])].sort(),
  });
const shipped = new Set(defaultScriptCatalog.map(identity));
export function scriptOrigin(
  script: ManagedScript,
  provenance?: AutomationProvenance,
): "app-provided" | "external" | "custom" {
  if (
    provenance?.sourceUrl ||
    provenance?.sourceSha256 ||
    provenance?.sourceId ||
    provenance?.publisher
  )
    return "external";
  return shipped.has(identity(script)) ? "app-provided" : "custom";
}
