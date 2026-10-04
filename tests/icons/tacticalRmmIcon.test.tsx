import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { BRAND_ICONS } from "../../src/utils/icons/brand";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { getConnectionIconResolution } from "../../src/components/connection/connectionTree/helpers";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";

const saved: Connection = {
  id: "tactical-fixture",
  name: "RMM",
  protocol: "https",
  hostname: "rmm.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  httpApplication: { version: 1, id: "tacticalrmm", loginMode: "manual" },
};
afterEach(() => {
  cleanup();
  publishIconLibrary(undefined, { ready: false });
});

describe("Tactical RMM publisher icon", () => {
  it.each(["Tactical RMM", "tacticalrmm", "TRMM", "AmidaWare"])(
    "is searchable by %s",
    (query) => {
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        "tacticalrmm",
      );
    },
  );

  it.each(["#f8fafc", "#172033"])(
    "renders passive publisher wolf contours in theme color %s",
    (color) => {
      const entry = getConnectionIconDefinition("tacticalrmm")!;
      expect(entry).toBeDefined();
      expect(entry.icon).toBe(BRAND_ICONS.tacticalrmm);
      const Icon = entry.icon;
      for (const size of [16, 24, 96]) {
        const { container, unmount } = render(
          <Icon size={size} color={color} />,
        );
        expect(container.querySelector("svg")).toHaveAttribute(
          "width",
          String(size),
        );
        expect(container.querySelector("svg")).toHaveAttribute(
          "viewBox",
          "0 0 24 24",
        );
        const paths = container.querySelectorAll("path");
        expect(paths).toHaveLength(10);
        expect([...paths].map((path) => path.getAttribute("d"))).toContain(
          "M4 0L5.68 13.44L24.08 12.16L4 0Z",
        );
        for (const path of paths) {
          expect(path).toHaveAttribute("fill", "currentColor");
          expect(path).toHaveAttribute("stroke", "none");
          expect(path).toHaveAttribute(
            "transform",
            "translate(1.1466666667 1) scale(0.3666666667)",
          );
        }
        expect(
          container.querySelector(
            "image,img,script,foreignObject,text,use,defs,filter,mask",
          ),
        ).toBeNull();
        expect(container.innerHTML).not.toMatch(/(?:href=|url\(|data:image)/);
        unmount();
      }
      publishIconLibrary(undefined, { ready: true });
      expect(() =>
        parsePassiveSvg(exportLibrarySvg("tacticalrmm")),
      ).not.toThrow();
    },
  );

  it.each(["http", "https"] as const)(
    "uses the saved %s application in the tree/shared tab resolver without mutating the record",
    (protocol) => {
      const connection = { ...saved, protocol };
      const before = structuredClone(connection);
      expect(getConnectionIconResolution(connection)).toMatchObject({
        key: "tacticalrmm",
        source: "application",
        overrideState: "unset",
      });
      expect(resolveEffectiveConnectionIcon(connection).key).toBe(
        "tacticalrmm",
      );
      expect(connection).toEqual(before);
      expect(getHttpApplicationIconSuggestion(connection)?.icon.key).toBe(
        "tacticalrmm",
      );
    },
  );

  it("preserves explicit overrides, folder precedence, invalid profiles and unrelated native defaults", () => {
    for (const icon of ["star", "web-application", "tacticalrmm"])
      expect(resolveEffectiveConnectionIcon({ ...saved, icon })).toMatchObject({
        key: icon,
        source: "override",
      });
    expect(
      resolveEffectiveConnectionIcon({ ...saved, isGroup: true }).key,
    ).toBe("folder");
    expect(
      resolveEffectiveConnectionIcon({ ...saved, protocol: "ssh" }).key,
    ).toBe("ssh");
    expect(
      resolveEffectiveConnectionIcon({ ...saved, httpApplication: undefined })
        .key,
    ).toBe("https");
    expect(
      resolveEffectiveConnectionIcon({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }).key,
    ).toBe("https");
    expect(
      resolveEffectiveConnectionIcon({
        ...saved,
        httpApplication: { version: 1, id: "portainer", loginMode: "manual" },
      }).key,
    ).toBe("https");
    expect(
      resolveEffectiveConnectionIcon({ ...saved, icon: "future-icon" }),
    ).toMatchObject({
      key: "tacticalrmm",
      overrideState: "unknown",
      unknownOverrideKey: "future-icon",
    });
  });

  it("labels the automatic editor preview as an application, not a generic protocol fallback", () => {
    render(<ConnectionIconPicker connection={saved} onChange={() => {}} />);
    expect(
      screen.getByText("Automatic · Tactical RMM application"),
    ).toBeInTheDocument();
  });

  it("uses the brand in the application selector and suggestion without changing the saved override implicitly", () => {
    const initial = { ...saved, icon: "star" };
    function Fixture() {
      const [formData, setFormData] = useState<Partial<Connection>>(initial);
      return (
        <>
          <HTTPOptions
            formData={formData}
            setFormData={setFormData}
            sections={["application"]}
          />
          <output data-testid="saved-value">{JSON.stringify(formData)}</output>
        </>
      );
    }
    render(<Fixture />);
    const selector = screen.getByRole("combobox", {
      name: /^Website application/,
    });
    expect(selector.querySelector("svg.lucide-tactical-rmm")).not.toBeNull();
    fireEvent.click(selector);
    expect(
      screen
        .getByRole("option", { name: "Tactical RMM" })
        .querySelector("svg.lucide-tactical-rmm"),
    ).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole("option", { name: "Tactical RMM" }));
    expect(
      JSON.parse(screen.getByTestId("saved-value").textContent!).icon,
    ).toBe("star");
    fireEvent.click(screen.getByRole("button", { name: "Use suggested icon" }));
    expect(
      JSON.parse(screen.getByTestId("saved-value").textContent!).icon,
    ).toBe("tacticalrmm");
  });
});
