import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sun } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { EMOJI_ICONS } from "../../src/utils/icons/catalog/emojis";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import {
  discardIconImport,
  exportLibrarySvg,
  previewIconImport,
} from "../../src/hooks/icons/useIconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";

const save = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ saveIconLibrary: save }) },
}));

const CHOICES = [
  {
    key: "rising-sun",
    category: "generic-shapes",
    queries: ["rising sun", "sunrise", "dawn", "🌅"],
  },
  {
    key: "sunny-day",
    category: "generic-shapes",
    queries: ["sunny day", "sunshine", "landscape", "☀️"],
  },
  {
    key: "deity-thanatos",
    category: "deities-religion",
    queries: ["thanatos", "lowered torch"],
  },
  {
    key: "religion-buddha",
    category: "deities-religion",
    queries: ["buddha", "budda", "buddhism", "meditation"],
  },
  {
    key: "religion-angel",
    category: "deities-religion",
    queries: ["angel", "guardian angel", "halo"],
  },
  {
    key: "emoji-dorky",
    category: "emojis",
    queries: ["dorky", "nerd", "goofy", "🤓"],
  },
  {
    key: "emoji-heart-eyes",
    category: "emojis",
    queries: ["heart eyes", "adoring", "😍"],
  },
  {
    key: "emoji-sleeping",
    category: "emojis",
    queries: ["sleeping", "asleep", "😴"],
  },
  {
    key: "emoji-confused",
    category: "emojis",
    queries: ["confused", "puzzled", "😕"],
  },
  {
    key: "emoji-eye-roll",
    category: "emojis",
    queries: ["eye roll", "rolling eyes", "🙄"],
  },
  {
    key: "emoji-crying",
    category: "emojis",
    queries: ["crying", "tears", "😭"],
  },
  {
    key: "emoji-nervous",
    category: "emojis",
    queries: ["nervous", "sweat", "😰"],
  },
  { key: "emoji-zany", category: "emojis", queries: ["zany", "tongue", "🤪"] },
  {
    key: "emoji-neutral",
    category: "emojis",
    queries: ["neutral", "expressionless", "😐"],
  },
  {
    key: "emoji-shushing",
    category: "emojis",
    queries: ["shushing", "quiet", "🤫"],
  },
  {
    key: "emoji-mind-blown",
    category: "emojis",
    queries: ["mind blown", "exploding head", "🤯"],
  },
  {
    key: "emoji-party-face",
    category: "emojis",
    queries: ["party face", "partying", "🥳"],
  },
  {
    key: "emoji-robot",
    category: "emojis",
    queries: ["robot face", "android", "🤖"],
  },
] as const;

function svg(key: string, size = 24, color = "#242933") {
  const entry = getConnectionIconDefinition(key)!;
  return new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(entry.icon, {
        size,
        style: { color },
        "aria-label": entry.ariaLabel,
      }),
    ),
    "image/svg+xml",
  ).documentElement;
}

beforeEach(() => {
  publishIconLibrary(undefined, { ready: true });
  save.mockClear();
});

describe("weather, mythic and expanded emoji choices", () => {
  it.each(CHOICES)(
    "finds $key by plain and Unicode aliases in its correct category",
    ({ key, category, queries }) => {
      const entry = getConnectionIconDefinition(key);
      expect(entry?.category).toBe(category);
      for (const query of queries)
        expect(filterConnectionIcons(query).map((item) => item.key)).toContain(
          key,
        );
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "ssh", icon: key })),
        ),
      ).toMatchObject({ key, source: "override" });
    },
  );

  it.each(CHOICES)(
    "renders $key passively at 16/24/32/96 on light and dark surfaces",
    ({ key }) => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        for (const size of [16, 24, 32, 96]) {
          for (const color of ["#242933", "#e9edf5"]) {
            const node = svg(key, size, color);
            expect(node.getAttribute("viewBox")).toBe("0 0 24 24");
            expect(node.getAttribute("width")).toBe(String(size));
            expect(node.getAttribute("height")).toBe(String(size));
            expect(node.getAttribute("style")).toContain(`color:${color}`);
            expect(node.getAttribute("aria-label")).toBeTruthy();
            expect(
              node.querySelector("path, circle, rect, ellipse"),
            ).not.toBeNull();
            expect(
              node.querySelector(
                "text, image, mask, use, script, foreignObject, filter, clipPath",
              ),
            ).toBeNull();
            expect(node.innerHTML).not.toMatch(
              /(?:href=|url\(|data:image|NaN|Infinity)/i,
            );
            for (const shape of node.querySelectorAll("[fill], [stroke]")) {
              for (const attribute of ["fill", "stroke"]) {
                const value = shape.getAttribute(attribute);
                if (value) expect(["none", "currentColor"]).toContain(value);
              }
            }
          }
        }
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    },
  );

  it.each(CHOICES)(
    "strictly exports and previews reimport of $key without storage writes",
    ({ key }) => {
      const exported = exportLibrarySvg(key);
      const parsed = parsePassiveSvg(exported);
      expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
      const preview = previewIconImport(exported, "svg", `Review ${key}`);
      try {
        expect(preview.entries).toHaveLength(1);
        expect(preview.entries[0]).toMatchObject({
          kind: "custom",
          label: `Review ${key}`,
        });
        expect(preview.conflicts).toEqual([]);
        expect(preview.warnings).toEqual([
          "Built-in entries reference this app's catalog; only custom entries bundle vector artwork. JSON packs and SVG exports are plaintext files.",
        ]);
        expect(save).not.toHaveBeenCalled();
      } finally {
        discardIconImport(preview);
      }
    },
  );

  it("preserves the existing sun and gives every new choice distinct geometry", () => {
    expect(getConnectionIconDefinition("sun")?.icon).toBe(Sun);
    const keys = ["sun", ...CHOICES.map(({ key }) => key)];
    expect(new Set(keys.map((key) => svg(key).innerHTML)).size).toBe(
      keys.length,
    );
    expect(new Set(CONNECTION_ICON_CATALOG.map(({ key }) => key)).size).toBe(
      CONNECTION_ICON_CATALOG.length,
    );
  });

  it("retains the original twelve emojis and expands to 25 distinct expressions", () => {
    expect(EMOJI_ICONS).toHaveLength(25);
    for (const suffix of [
      "smile",
      "laugh",
      "wink",
      "sad",
      "angry",
      "surprised",
      "cool",
      "thinking",
      "thumbs-up",
      "thumbs-down",
      "party",
      "fire",
    ])
      expect(EMOJI_ICONS.some(({ key }) => key === `emoji-${suffix}`)).toBe(
        true,
      );
    expect(new Set(EMOJI_ICONS.map(({ key }) => svg(key).innerHTML)).size).toBe(
      25,
    );
  });
});
