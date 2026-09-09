import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import {
  getConnectionIconDefinition,
  CONNECTION_ICON_CATALOG,
  type ConnectionIconKey,
} from "../../src/utils/icons/connectionIconCatalog";
import { FILE_TYPE_ICONS } from "../../src/utils/icons/catalog/fileTypes";
import { BANKING_ICONS } from "../../src/utils/icons/catalog/banking";
import { LLM_VARIANT_ICONS } from "../../src/utils/icons/catalog/llmVariants";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

const FILES = [
  "file-pdf",
  "file-image",
  "file-audio",
  "file-video",
  "file-json",
  "file-xml",
  "file-csv",
  "file-spreadsheet",
  "file-presentation",
  "file-document",
  "file-config",
  "file-log",
  "file-backup",
  "file-certificate",
  "file-database",
  "file-binary",
] as const;
const BANKING = [
  "banking",
  "bank-account",
  "bank-transfer",
  "bank-cash",
  "bank-coins",
  "bank-safe",
  "bank-atm",
] as const;
const LLM = ["llm-chat", "llm-neural", "llm-local"] as const;
const DATABASES = [
  "sqlite",
  "sqlite-database",
  "sqlite-server",
  "cockroachdb",
  "cockroachdb-server",
  "clickhouse",
  "clickhouse-server",
  "cassandra",
  "cassandra-server",
  "couchdb",
  "couchdb-server",
  "neo4j",
  "neo4j-server",
  "influxdb",
  "influxdb-server",
  "oracle-db",
  "oracle-db-server",
  "mysql-server",
  "mariadb-server",
  "postgresql-server",
  "mongodb-server",
  "redis-server",
  "mssql-server",
] as const;
const REQUESTED = [
  ...FILES,
  ...BANKING,
  ...LLM,
  ...DATABASES,
  "oracle",
  "redhat-cloud-brand",
  "aws",
] as const satisfies readonly ConnectionIconKey[];

function svgFor(key: string) {
  const entry = getConnectionIconDefinition(key);
  expect(entry, key).toBeDefined();
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(createElement(entry!.icon));
  const svg = container.querySelector("svg")!;
  expect(svg, key).not.toBeNull();
  expect(
    svg.querySelector("path,rect,circle,ellipse,line,polyline,polygon"),
    key,
  ).not.toBeNull();
  expect(svg.querySelector("text,image,foreignObject,use"), key).toBeNull();
  return svg;
}
function geometry(svg: Element) {
  const clone = svg.cloneNode(true) as Element;
  for (const node of Array.from(clone.querySelectorAll("[class]")))
    node.removeAttribute("class");
  return clone.innerHTML;
}

describe("cloud, databases, files, banking and language model symbols", () => {
  it("preserves the original 52 choices and the expanded isolated catalog leaves", () => {
    expect(FILES).toHaveLength(16);
    expect(BANKING).toHaveLength(7);
    expect(LLM).toHaveLength(3);
    expect(DATABASES).toHaveLength(23);
    expect(REQUESTED).toHaveLength(52);
    expect(new Set(REQUESTED).size).toBe(52);
    expect(FILE_TYPE_ICONS.map((entry) => entry.key)).toEqual(FILES);
    expect(BANKING_ICONS.map((entry) => entry.key)).toEqual([
      "credit-card-contactless",
      ...BANKING,
    ]);
    expect(LLM_VARIANT_ICONS.map((entry) => entry.key)).toEqual(LLM);
    for (const entry of [
      ...FILE_TYPE_ICONS,
      ...BANKING_ICONS,
      ...LLM_VARIANT_ICONS,
    ]) {
      expect(getConnectionIconDefinition(entry.key)?.icon, entry.key).toBe(
        entry.icon,
      );
    }
  });
  it.each(REQUESTED)("renders and finds %s", (key) => {
    expect(geometry(svgFor(key))).not.toBe("");
    expect(
      filterConnectionIcons(key.replace(/-/g, " ")).map((entry) => entry.key),
    ).toContain(key);
  });
  it.each(REQUESTED)(
    "preserves explicit %s through normalization and resolution",
    (key) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "latest-icon",
            name: "Latest icon",
            protocol: "rdp",
            icon: key,
          }),
        ),
      );
      expect(restored.icon).toBe(key);
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          protocol: restored.protocol ?? "rdp",
        }),
      ).toMatchObject({ key, source: "override" });
    },
  );
  it.each([
    ["file-pdf", "PDF"],
    ["file-image", "JPEG"],
    ["file-audio", "MP3"],
    ["file-video", "MP4"],
    ["file-json", "JSON"],
    ["file-xml", "XML"],
    ["file-csv", "comma separated values"],
    ["file-spreadsheet", "XLSX"],
    ["file-presentation", "PPTX"],
    ["file-document", "DOCX"],
    ["file-config", "YAML"],
    ["file-log", "logs"],
    ["file-backup", "ZIP"],
    ["file-certificate", "PEM"],
    ["file-database", "SQL dump"],
    ["file-binary", "firmware"],
    ["bank-account", "IBAN"],
    ["bank-transfer", "SEPA"],
    ["bank-atm", "cash machine"],
    ["llm-chat", "conversational AI"],
    ["llm-neural", "neural network"],
    ["llm-local", "local inference"],
  ])("finds %s using %s", (key, query) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
  });
  it("keeps all 16 file formats, 8 banking choices and 4 plain LLM variants distinct", () => {
    for (const keys of [FILES, [...BANKING, "payment-card"], ["llm", ...LLM]]) {
      expect(new Set(keys.map((key) => geometry(svgFor(key)))).size).toBe(
        keys.length,
      );
    }
    for (const key of ["file-image", "file-audio", "file-video"]) {
      expect(
        filterConnectionIcons("multimedia").map((entry) => entry.key),
      ).toContain(key);
    }
    for (const key of FILES)
      expect(getConnectionIconDefinition(key)?.category).toBe("files");
    for (const key of LLM)
      expect(getConnectionIconDefinition(key)?.category).toBe(
        "devops-monitoring",
      );
  });
  it.each([
    ["sqlite", "sqlite-database"],
    ["sqlite", "sqlite-server"],
    ["cockroachdb", "cockroachdb-server"],
    ["clickhouse", "clickhouse-server"],
    ["cassandra", "cassandra-server"],
    ["couchdb", "couchdb-server"],
    ["neo4j", "neo4j-server"],
    ["influxdb", "influxdb-server"],
    ["oracle-db", "oracle-db-server"],
    ["mysql", "mysql-server"],
    ["mariadb", "mariadb-server"],
    ["postgresql", "postgresql-server"],
    ["mongodb", "mongodb-server"],
    ["redis", "redis-server"],
    ["mssql", "mssql-server"],
  ])(
    "keeps %s plain and %s framed with the identical vendor glyph",
    (base, role) => {
      const plain = svgFor(base);
      const framed = svgFor(role);
      expect(plain.querySelector("[data-role-frame]")).toBeNull();
      expect(framed.querySelector("[data-role-frame]")).not.toBeNull();
      expect(geometry(framed.querySelector("svg")!)).toBe(geometry(plain));
      expect(geometry(framed)).not.toBe(geometry(plain));
    },
  );
  it("provides semantic plain cloud providers instead of treating Oracle ERP as Oracle Cloud", () => {
    for (const key of [
      "oracle",
      "hetzner",
      "ovh",
      "digitalocean",
      "alibabacloud",
      "ibm",
      "redhat-cloud-brand",
      "aws",
    ]) {
      const entry = getConnectionIconDefinition(key);
      expect(entry?.category, key).toBe("cloud");
      expect(svgFor(key).querySelector("[data-role-frame]"), key).toBeNull();
    }
    expect(
      filterConnectionIcons("oracle cloud").map((entry) => entry.key),
    ).toContain("oracle");
    expect(getConnectionIconDefinition("oracle-erp")?.category).toBe(
      "web-applications",
    );
    expect(getConnectionIconDefinition("oracle")?.label).not.toMatch(
      /ERP|database/i,
    );
  });
  it("separates plain vendors from appliances without changing stored component identity", () => {
    const vendors = CONNECTION_ICON_CATALOG.filter(
      (entry) => entry.category === "vendors",
    );
    expect(vendors.length).toBeGreaterThan(20);
    for (const entry of vendors)
      expect(
        svgFor(entry.key).querySelector("[data-role-frame]"),
        entry.key,
      ).toBeNull();
    for (const key of ["dell", "hpe", "lenovo", "synology", "cisco"]) {
      expect(getConnectionIconDefinition(key)?.category, key).toBe("vendors");
    }
    for (const key of [
      "dell-server",
      "hpe-switch",
      "lenovo-server",
      "synology-nas",
      "cisco-access-point",
    ]) {
      expect(getConnectionIconDefinition(key)?.category, key).toBe(
        "vendors-hardware",
      );
    }
  });
  it("shows and selects real plain vendor and hardware choices in separate picker sections", () => {
    const onChange = vi.fn();
    render(
      <ConnectionIconPicker
        connection={{ protocol: "ssh" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "dell" } },
    );
    const plain = within(
      screen.getByRole("listbox", { name: "Vendors & brands icons" }),
    ).getByRole("option", { name: "Dell (dell)" });
    const appliance = within(
      screen.getByRole("listbox", { name: "Hardware & appliances icons" }),
    ).getByRole("option", { name: "Dell server (dell-server)" });
    expect(plain.querySelector("[data-role-frame]")).toBeNull();
    expect(
      appliance.querySelector('[data-role-frame="server"]'),
    ).not.toBeNull();
    fireEvent.click(plain);
    fireEvent.click(appliance);
    expect(onChange.mock.calls).toEqual([["dell"], ["dell-server"]]);
  });
});
