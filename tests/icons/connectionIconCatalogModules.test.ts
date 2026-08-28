import { describe, expect, it } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  CONNECTION_ICON_CATEGORIES,
  getConnectionIconsByCategory,
  type ConnectionIconCategory,
  type ConnectionIconDefinition,
  type ConnectionIconKey,
} from "../../src/utils/icons/connectionIconCatalog";
import { CLOUD_ICONS } from "../../src/utils/icons/catalog/cloud";
import { COMMUNICATION_ICONS } from "../../src/utils/icons/catalog/communication";
import { DATABASE_ICONS } from "../../src/utils/icons/catalog/databases";
import { DEVOPS_MONITORING_ICONS } from "../../src/utils/icons/catalog/devopsMonitoring";
import { FILES_ICONS } from "../../src/utils/icons/catalog/files";
import { GENERIC_SHAPE_ICONS } from "../../src/utils/icons/catalog/genericShapes";
import { NETWORK_ICONS } from "../../src/utils/icons/catalog/network";
import { OPERATING_SYSTEM_ICONS } from "../../src/utils/icons/catalog/operatingSystems";
import { REMOTE_PROTOCOL_ICONS } from "../../src/utils/icons/catalog/remoteProtocols";
import { SECURITY_ICONS } from "../../src/utils/icons/catalog/security";
import { SERVERS_DEVICES_ICONS } from "../../src/utils/icons/catalog/serversDevices";
import { VENDORS_HARDWARE_ICONS } from "../../src/utils/icons/catalog/vendorsHardware";
import { VIRTUALIZATION_ICONS } from "../../src/utils/icons/catalog/virtualization";
import { VOICE_TELEPHONY_ICONS } from "../../src/utils/icons/catalog/voiceTelephony";
import { WEB_APPLICATION_ICONS } from "../../src/utils/icons/catalog/webApplications";
import { CONNECTION_ICON_CATEGORY_LABELS } from "../../src/components/connection/editor/connectionIconPickerModel";

type CatalogModule = {
  readonly name: string;
  readonly category: ConnectionIconCategory;
  readonly entries: readonly ConnectionIconDefinition[];
};

/**
 * One module per category, in the order `connectionIconCatalog.ts` spreads them.
 * Adding a category means adding a module here as well.
 */
const CATALOG_MODULES: readonly CatalogModule[] = [
  {
    name: "remoteProtocols",
    category: "remote-protocols",
    entries: REMOTE_PROTOCOL_ICONS,
  },
  {
    name: "serversDevices",
    category: "servers-devices",
    entries: SERVERS_DEVICES_ICONS,
  },
  { name: "network", category: "network", entries: NETWORK_ICONS },
  { name: "cloud", category: "cloud", entries: CLOUD_ICONS },
  { name: "databases", category: "databases", entries: DATABASE_ICONS },
  {
    name: "devopsMonitoring",
    category: "devops-monitoring",
    entries: DEVOPS_MONITORING_ICONS,
  },
  { name: "security", category: "security", entries: SECURITY_ICONS },
  { name: "files", category: "files", entries: FILES_ICONS },
  {
    name: "communication",
    category: "communication",
    entries: COMMUNICATION_ICONS,
  },
  {
    name: "genericShapes",
    category: "generic-shapes",
    entries: GENERIC_SHAPE_ICONS,
  },
  {
    name: "operatingSystems",
    category: "operating-systems",
    entries: OPERATING_SYSTEM_ICONS,
  },
  {
    name: "virtualization",
    category: "virtualization",
    entries: VIRTUALIZATION_ICONS,
  },
  {
    name: "vendorsHardware",
    category: "vendors-hardware",
    entries: VENDORS_HARDWARE_ICONS,
  },
  {
    name: "voiceTelephony",
    category: "voice-telephony",
    entries: VOICE_TELEPHONY_ICONS,
  },
  {
    name: "webApplications",
    category: "web-applications",
    entries: WEB_APPLICATION_ICONS,
  },
];

describe("connection icon catalog modules", () => {
  it("composes exactly one module per declared category", () => {
    expect(CATALOG_MODULES.map((module) => module.category)).toEqual([
      ...CONNECTION_ICON_CATEGORIES,
    ]);
    expect(CONNECTION_ICON_CATEGORIES).toHaveLength(15);
  });

  it("composes the catalog from every module without dropping entries", () => {
    const total = CATALOG_MODULES.reduce(
      (sum, module) => sum + module.entries.length,
      0,
    );

    expect(CONNECTION_ICON_CATALOG).toHaveLength(total);
    expect(CONNECTION_ICON_CATALOG.map((definition) => definition.key)).toEqual(
      CATALOG_MODULES.flatMap((module) =>
        module.entries.map((definition) => definition.key),
      ),
    );
  });

  it("keeps stable keys globally unique across modules", () => {
    const keys = CONNECTION_ICON_CATALOG.map((definition) => definition.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);

    expect(duplicates, `duplicate icon keys: ${duplicates.join(", ")}`).toEqual(
      [],
    );
  });

  it("keeps every entry in the module matching its declared category", () => {
    CATALOG_MODULES.forEach((module) => {
      expect(module.entries.length, `${module.name} is empty`).toBeGreaterThan(
        0,
      );
      module.entries.forEach((definition) => {
        expect(
          definition.category,
          `${definition.key} lives in ${module.name} but declares ${definition.category}`,
        ).toBe(module.category);
      });
      expect(getConnectionIconsByCategory(module.category)).toHaveLength(
        module.entries.length,
      );
    });
  });

  it("labels every category, including the ones added with the split", () => {
    CONNECTION_ICON_CATEGORIES.forEach((category) => {
      expect(
        CONNECTION_ICON_CATEGORY_LABELS[category]?.trim(),
        `${category} needs a picker label`,
      ).toBeTruthy();
    });
  });

  it("keeps ConnectionIconKey a literal union after the module split", () => {
    // Regression guard: if a module ever widens the composed tuple, `key`
    // degrades to `string` and both assertions below stop being meaningful.
    const key: ConnectionIconKey = "terminal";
    expect(key).toBe("terminal");

    // @ts-expect-error "definitely-not-a-key" is not a catalog key
    const invalid: ConnectionIconKey = "definitely-not-a-key";
    expect(invalid).toBe("definitely-not-a-key");
  });
});
