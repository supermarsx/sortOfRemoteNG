import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as simpleIcons from "simple-icons";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { MESSAGING_PLATFORM_ICONS } from "../../src/utils/icons/catalog/messagingPlatforms";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import {
  slack,
  mattermost,
  rocketdotchat,
  matrix,
  zulip,
  element,
  MESSAGING_PUBLISHER_BRAND_ICONS,
} from "../../src/utils/icons/brand";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      saveIconLibrary: () => {
        throw new Error(
          "Read-only messaging icon tests must not write settings",
        );
      },
    }),
  },
}));
const requested = [
  ["discord", "community chat"],
  ["telegram", "telegram messenger"],
  ["whatsapp", "whats app"],
  ["signal", "signal messenger"],
  ["messenger", "facebook messenger"],
  ["microsoft-teams", "ms teams"],
  ["google-chat", "google workspace chat"],
  ["google-messages", "android messages"],
  ["line", "line messenger"],
  ["viber", "rakuten viber"],
  ["wechat", "we chat"],
  ["qq", "tencent qq"],
  ["kakaotalk", "kakao talk"],
  ["snapchat", "snap chat"],
  ["imessage", "i message"],
  ["irc", "internet relay chat"],
  ["xmpp", "jabber"],
  ["simplex", "simplex chat"],
  ["session", "session messenger"],
  ["threema", "threema messenger"],
  ["mumble", "murmur"],
  ["teamspeak", "team speak"],
  ["zoom", "zoom meetings"],
  ["webex", "cisco webex"],
  ["wire", "wire messenger"],
  ["delta-chat", "deltachat"],
  ["briar", "briar messenger"],
  ["jami", "jami messenger"],
  ["nextcloud-talk", "nextcloudtalk"],
  ["gitter", "gitter chat"],
  ["slack", "slack"],
  ["mattermost", "mattermost"],
  ["rocket-chat", "rocket.chat"],
  ["matrix", "matrix"],
  ["zulip", "zulip"],
  ["element", "matrix client"],
] as const;
const pinned = [
  ["discord", "siDiscord"],
  ["telegram", "siTelegram"],
  ["whatsapp", "siWhatsapp"],
  ["signal", "siSignal"],
  ["messenger", "siMessenger"],
  ["google-chat", "siGooglechat"],
  ["google-messages", "siGooglemessages"],
  ["line", "siLine"],
  ["viber", "siViber"],
  ["wechat", "siWechat"],
  ["qq", "siQq"],
  ["kakaotalk", "siKakaotalk"],
  ["snapchat", "siSnapchat"],
  ["imessage", "siImessage"],
  ["xmpp", "siXmpp"],
  ["simplex", "siSimplex"],
  ["session", "siSession"],
  ["threema", "siThreema"],
  ["mumble", "siMumble"],
  ["teamspeak", "siTeamspeak"],
  ["zoom", "siZoom"],
  ["webex", "siWebex"],
  ["wire", "siWire"],
  ["gitter", "siGitter"],
] as const;
const publisherPathHashes = {
  microsoftteams:
    "51e47cc5e6ddc64f20ebff1dac6da1547d7ed2d830f9b3d14c7add3d06c1fdc2",
  deltachat: "41ccf16972732f27fb4ed3ce5d40d00067615253cc0f5bb51807cadd063f928f",
  briar: "782367ad31963533cda9f6ec4dadb3b3fa9e210bbb51c9ee7cbacac46ce2687a",
  jami: "03cc4be4b5e628ca3d59f41293a92f753349d15b901bdb70a6b4af2e88021ead",
  nextcloudtalk:
    "09c2fe1967ba0dbf7cebbd13fefda8277d99f355dffa79a2b0b6a2bd7112d7ad",
} as const;

function svgFor(key: string, size = 24) {
  const entry = getConnectionIconDefinition(key)!;
  expect(entry, key).toBeDefined();
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry.icon, { size, color: "#648bc4" })),
    "image/svg+xml",
  ).documentElement;
}
function pathData(svg: Element) {
  return Array.from(svg.querySelectorAll("path")).map((p) =>
    p.getAttribute("d"),
  );
}
beforeEach(() => publishIconLibrary(undefined, { ready: true }));

describe("messaging-platform icon batch", () => {
  it.each(requested)(
    "keeps %s unique, searchable by %s, and persisted without fallback",
    (key, query) => {
      expect(
        CONNECTION_ICON_CATALOG.filter((entry) => entry.key === key),
      ).toHaveLength(1);
      expect(getConnectionIconDefinition(key)?.category).toBe("communication");
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "ssh", icon: key })),
        ),
      ).toMatchObject({ key, source: "override" });
    },
  );

  it.each(requested)(
    "renders %s as pure passive theme geometry at all review sizes",
    (key) => {
      for (const size of [16, 24, 32, 96]) {
        const svg = svgFor(key, size);
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("width")).toBe(String(size));
        expect(svg.getAttribute("height")).toBe(String(size));
        expect(svg.getAttribute("stroke")).toBe("#648bc4");
        expect(
          svg.querySelector("path,rect,circle,line,polyline"),
        ).not.toBeNull();
        expect(
          svg.querySelector(
            "svg,[data-role-frame],image,text,use,script,foreignObject,mask,clipPath,filter,[href],[style]",
          ),
        ).toBeNull();
        expect(svg.innerHTML).not.toMatch(/NaN|Infinity|url\(/);
        for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))])
          for (const attr of Array.from(element.attributes))
            if (["fill", "stroke"].includes(attr.name))
              expect(["none", "currentColor", "#648bc4"]).toContain(attr.value);
      }
    },
  );

  it.each(requested)(
    "round-trips %s through the real strict icon-library exporter",
    (key) => {
      const exported = exportLibrarySvg(key);
      const parsed = parsePassiveSvg(exported);
      expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
      const svg = new DOMParser().parseFromString(
        exported,
        "image/svg+xml",
      ).documentElement;
      expect(pathData(svg)).toEqual(pathData(svgFor(key)));
    },
  );

  it("retains all six existing communication platform glyphs and saved keys", () => {
    for (const [key, icon] of [
      ["slack", slack],
      ["mattermost", mattermost],
      ["rocket-chat", rocketdotchat],
      ["matrix", matrix],
      ["zulip", zulip],
      ["element", element],
    ] as const)
      expect(getConnectionIconDefinition(key)?.icon).toBe(icon);
  });

  it("adds exactly thirty distinct choices without relabeling another product", () => {
    expect(MESSAGING_PLATFORM_ICONS).toHaveLength(30);
    expect(
      new Set(
        MESSAGING_PLATFORM_ICONS.map((entry) => svgFor(entry.key).innerHTML),
      ).size,
    ).toBe(30);
    expect(svgFor("nextcloud-talk").innerHTML).not.toBe(
      svgFor("nextcloud").innerHTML,
    );
    expect(svgFor("microsoft-teams").innerHTML).not.toBe(
      svgFor("windows").innerHTML,
    );
    expect(getConnectionIconDefinition("irc")?.description).toMatch(
      /Generic app-authored.*not an official/,
    );
    expect(svgFor("irc").querySelectorAll("path")).toHaveLength(2);
  });

  it.each(pinned)(
    "retains the pinned Simple Icons geometry for %s",
    (key, symbol) => {
      expect(pathData(svgFor(key))).toEqual([simpleIcons[symbol].path]);
    },
  );

  it.each(Object.entries(MESSAGING_PUBLISHER_BRAND_ICONS))(
    "retains the verified publisher paths for %s",
    (name, Icon) => {
      const svg = new DOMParser().parseFromString(
        renderToStaticMarkup(createElement(Icon)),
        "image/svg+xml",
      ).documentElement;
      expect(
        createHash("sha256").update(pathData(svg).join("|")).digest("hex"),
      ).toBe(publisherPathHashes[name as keyof typeof publisherPathHashes]);
    },
  );

  it("keeps theme-safe Teams letter contrast, the Delta Chat contour and Talk counter", () => {
    const teams = svgFor("microsoft-teams");
    expect(teams.querySelectorAll("path")).toHaveLength(5);
    expect(teams.querySelector("rect")?.getAttribute("fill")).toBe("none");
    expect(teams.querySelector("rect")?.getAttribute("stroke")).toBe(
      "currentColor",
    );
    expect(teams.querySelectorAll("[opacity]")).toHaveLength(3);
    const delta = svgFor("delta-chat");
    expect(delta.querySelectorAll("path")).toHaveLength(2);
    expect(delta.querySelector("path")?.getAttribute("fill")).toBe("none");
    expect(
      svgFor("nextcloud-talk").querySelector("path")?.getAttribute("fill-rule"),
    ).toBe("evenodd");
    expect(svgFor("briar").querySelectorAll("path")).toHaveLength(2);
    expect(svgFor("jami").querySelectorAll("path")).toHaveLength(13);
  });

  it("renders custom nodes without unstable React key warnings", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const entry of MESSAGING_PLATFORM_ICONS)
        renderToStaticMarkup(createElement(entry.icon));
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(
        /unique.*key|same key/i,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
