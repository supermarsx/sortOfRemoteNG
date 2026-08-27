import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { mailSubTabs } from "../../src/components/integrations/mail/registry";
import { integrationRegistry } from "../../src/types/integrations/registry";

const supportMatrix = readFileSync(
  join(process.cwd(), "docs", "integrations.md"),
  "utf8",
);

const markerCount = (marker: string): number =>
  supportMatrix.split(marker).length - 1;

describe("integration support matrix", () => {
  it("has the expected registered surface", () => {
    expect(integrationRegistry).toHaveLength(26);
    expect(mailSubTabs).toHaveLength(9);
  });

  it("documents every registered top-level integration exactly once", () => {
    for (const descriptor of integrationRegistry) {
      expect(
        markerCount(`<!-- integration:${descriptor.key} -->`),
        `missing or duplicate support-matrix entry for ${descriptor.key}`,
      ).toBe(1);
    }
  });

  it("documents every registered Mail sub-tab exactly once", () => {
    for (const tab of mailSubTabs) {
      expect(
        markerCount(`<!-- mail-subtab:${tab.subTabKey} -->`),
        `missing or duplicate support-matrix entry for ${tab.subTabKey}`,
      ).toBe(1);
    }
  });
});
