import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  OS_TAG_LABELS,
  OS_TAG_ICONS,
  type OSTag,
} from "../../src/components/recording/scriptManager/shared";
import { CONNECTION_ICON_REGISTRY } from "../../src/utils/icons/connectionIconCatalog";
import PlatformTagPicker from "../../src/components/recording/scriptManager/PlatformTagPicker";
import FilterToolbar from "../../src/components/recording/scriptManager/FilterToolbar";
import { normalizeAutomationEntry } from "../../src/utils/recording/automationLibraryValidation";
import {
  exportAutomationCatalog,
  parseAutomationCatalog,
} from "../../src/utils/recording/automationCatalog";
import { bundledScriptCatalog } from "../../src/data/bundledScriptCatalog";
import type { AutomationEntry } from "../../src/types/recording/automationLibrary";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
const specific: OSTag[] = [
  "debian",
  "ubuntu",
  "centos",
  "fedora",
  "rhel",
  "rocky-linux",
  "almalinux",
  "opensuse",
  "alpine",
  "arch-linux",
  "freebsd",
  "openbsd",
  "pfsense",
  "opnsense",
  "openwrt",
  "junos",
  "routeros",
  "fortios",
];

describe("canonical automation platforms", () => {
  it("exposes specific distro and network OS tags backed by real collection vector keys", () => {
    expect(Object.keys(OS_TAG_LABELS)).toHaveLength(28);
    for (const tag of specific) {
      expect(OS_TAG_LABELS[tag]).toBeTruthy();
      expect(
        CONNECTION_ICON_REGISTRY[
          OS_TAG_ICONS[tag] as keyof typeof CONNECTION_ICON_REGISTRY
        ],
      ).toBeDefined();
    }
    expect(OS_TAG_ICONS.ubuntu).toBe("ubuntu");
    expect(OS_TAG_ICONS.centos).toBe("centos");
  });

  it.each(specific)(
    "roundtrips %s through canonical persistence and package validators",
    (tag) => {
      const entry: AutomationEntry<"terminal-script"> = {
        family: "terminal-script",
        payload: {
          id: "fixture",
          name: "User assigned metadata",
          description: "No compatibility claim",
          script: "printf 'test'",
          language: "sh",
          category: "Custom",
          osTags: [tag],
          createdAt: "2026-09-10",
          updatedAt: "2026-09-10",
        },
      };
      expect(normalizeAutomationEntry(entry)).toEqual(entry);
      const parsed = parseAutomationCatalog(
        exportAutomationCatalog({ name: "Fixture", entries: [entry] }),
      );
      expect(parsed.entries[0].payload).toEqual(entry.payload);
    },
  );

  it("does not retag bundled entries with unsupported distro claims", () => {
    expect(bundledScriptCatalog).toHaveLength(191);
    expect(
      bundledScriptCatalog.some((entry) => entry.platforms.includes("ubuntu")),
    ).toBe(false);
    expect(
      bundledScriptCatalog.some((entry) => entry.platforms.includes("centos")),
    ).toBe(false);
  });

  it("filters the actual searchable script platform dropdown and calls only the selected filter", () => {
    const setOsTagFilter = vi.fn();
    const mgr = {
      searchFilter: "",
      categoryFilter: "",
      languageFilter: "",
      osTagFilter: "",
      categories: [],
      ready: true,
      busy: false,
      setOsTagFilter,
    };
    render(<FilterToolbar mgr={mgr as any} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Script platform" }));
    fireEvent.change(screen.getByPlaceholderText("Search platforms…"), {
      target: { value: "CentOS" },
    });
    expect(screen.queryByRole("option", { name: "Ubuntu" })).toBeNull();
    const option = screen.getByRole("option", {
      name: "CentOS / CentOS Stream",
    });
    expect(option.querySelector("svg")).toBeTruthy();
    fireEvent.mouseDown(option);
    expect(setOsTagFilter).toHaveBeenCalledWith("centos");
  });

  it("searches a bounded tag editor without losing selections hidden by the query", () => {
    function Fixture() {
      const [value, setValue] = useState<OSTag[]>(["linux"]);
      return (
        <PlatformTagPicker
          value={value}
          onToggle={(tag) =>
            setValue((current) =>
              current.includes(tag)
                ? current.filter((item) => item !== tag)
                : [...current, tag],
            )
          }
        />
      );
    }
    render(<Fixture />);
    expect(screen.getByRole("group", { name: "Platform tags" })).toHaveClass(
      "max-h-40",
      "overflow-y-auto",
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search platform tags" }),
      { target: { value: "ubuntu" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Ubuntu" }));
    expect(screen.getByRole("button", { name: "Ubuntu" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/2 selected/)).toHaveTextContent(
      "not a compatibility or execution guarantee",
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search platform tags" }),
      { target: { value: "linux" } },
    );
    expect(screen.getByRole("button", { name: "Linux" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
