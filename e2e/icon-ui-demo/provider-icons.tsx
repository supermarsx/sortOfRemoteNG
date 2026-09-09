import { demo } from "./boundary";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CONNECTION_ICON_CATALOG } from "../../src/utils/icons/connectionIconCatalog";
import { FOLDER_OPEN_ICONS } from "../../src/utils/icons/catalog/folders";

// Explicit review inventory: missing keys fail instead of silently showing a fallback.
const keys = [
  "display-multi-screen",
  "dns-pt",
  "dominios-pt",
  "ptisp",
  "ptservidor",
  "webtuga",
  "amen-pt",
  "hetzner",
  "ovh",
  "scaleway",
  "time4vps",
  "hostinger",
  "netcup",
  "upcloud",
  "wpengine",
  "bluehost",
  "freenom",
  "rackspace",
  "namesilo",
  "wix",
  "network-solutions",
  "spaceship",
  "noip",
  "dynamic-dns",
  "sapo",
  "cogent",
  "claranet",
  "isp",
  "putty",
  "contabo",
  "vultr",
  "ec2-instance",
  "hostgator",
  "exoscale",
];
const providerEntries = keys.map((key) => {
  const entry = CONNECTION_ICON_CATALOG.find((item) => item.key === key);
  if (!entry) throw new Error("Missing provider review icon: " + key);
  return entry;
});
const view = new URLSearchParams(location.search).get("view") ?? "providers";
const roles = [
  "folder",
  "folder-open",
  "server",
  "management-server",
  "database",
  "access-point",
  "switch",
  "router",
  "wired-router",
  "nas",
  "cloud",
  "printer",
  "laptop",
  "desktop",
  "remote-desktop",
  "phone",
  "desk-phone",
  "olt",
  "wall-terminal",
  "tablet",
  "ups",
  "pdu",
  "iot",
  "firewall",
  "vpn",
  "camera",
  "recorder",
];
const rendered =
  view === "providers"
    ? []
    : CONNECTION_ICON_CATALOG.map((entry) => ({
        entry,
        role: renderToStaticMarkup(<entry.icon />).match(
          /data-role-frame="([^"]+)"/,
        )?.[1],
      }));
const entries =
  view === "providers"
    ? providerEntries
    : view === "cloud-database"
      ? rendered
          .filter(({ role }) => role === "cloud" || role === "database")
          .map(({ entry }) => entry)
      : roles.map((role) => {
          if (role === "folder-open")
            return {
              key: "folder-ssh-open",
              label: "Open folder · SSH",
              icon: FOLDER_OPEN_ICONS["folder-ssh"],
            };
          const match = rendered.find((item) => item.role === role);
          if (!match) throw new Error("Missing actual catalog role: " + role);
          return { ...match.entry, label: role + " · " + match.entry.label };
        });
const heading =
  view === "providers"
    ? "Provider icon size review"
    : view === "cloud-database"
      ? "Cloud and database badge review"
      : "All 27 role silhouettes — actual catalog examples";

export function ProviderIcons() {
  useEffect(() => {
    demo.ready = true;
  }, []);
  return (
    <main
      style={{ padding: 24, fontFamily: "Arial, sans-serif", color: "#e5e7eb" }}
    >
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>{heading}</h1>
        <p style={{ margin: 0, color: "#b7bdc9", fontSize: 14 }}>
          Actual catalog vectors · 16 / 24 / 32 CSS pixels · light and dark
          surfaces
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b7bdc9" }}>
          Isolated demo — no live profile, native storage, or network
          connection. Identifying artwork is not a claim of provider
          endorsement.
        </p>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {entries.map(({ key, label, icon: Icon }) => (
          <article
            key={key}
            data-provider={key}
            style={{
              border: "1px solid #454b56",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <header
              style={{
                padding: "8px 12px",
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <strong style={{ fontSize: 14 }}>{label}</strong>
              <code style={{ fontSize: 11, color: "#adb5c5" }}>{key}</code>
            </header>
            {(["light", "dark"] as const).map((surface) => (
              <div
                key={surface}
                data-surface={surface}
                style={{
                  background: surface === "light" ? "#f4f5f7" : "#171b23",
                  color: surface === "light" ? "#222834" : "#e5e7eb",
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  padding: "6px 12px",
                  gap: 8,
                }}
              >
                {[16, 24, 32].map((size) => (
                  <div
                    key={size}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      height: 36,
                    }}
                  >
                    <span style={{ fontSize: 10, minWidth: 24 }}>{size}px</span>
                    <Icon
                      size={size}
                      style={{ width: size, height: size, flexShrink: 0 }}
                      aria-label={label + " " + size + " pixels"}
                    />
                  </div>
                ))}
              </div>
            ))}
          </article>
        ))}
      </div>
    </main>
  );
}
document.body.style.cssText = "margin:0;background:#101319";
createRoot(document.getElementById("root")!).render(<ProviderIcons />);
