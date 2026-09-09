import { demo } from "./boundary";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import IconExplorerTab from "../../src/components/icons/IconExplorerTab";
import { CONNECTION_ICON_CATALOG } from "../../src/utils/icons/connectionIconCatalog";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
publishIconLibrary(
  {
    version: 1,
    customIcons: [],
    builtInOverrides: {
      folder: {
        label: "Demo folder",
        notes: "Synthetic personal notes. Built-in artwork is unchanged.",
      },
    },
  },
  { ready: true },
);
demo.pack = JSON.stringify({
  format: "sorng-icon-library",
  version: 1,
  customIcons: [],
  builtInIcons: CONNECTION_ICON_CATALOG.slice(0, 105).map(({ key, label }) => ({
    key,
    label: "Reviewed " + label,
    notes: "Synthetic import review; never applied.",
  })),
});
export function Demo() {
  useEffect(() => {
    demo.ready = true;
  }, []);
  return (
    <>
      <div
        style={{
          height: 36,
          background: "#171717",
          color: "#ddd",
          padding: "8px 16px",
          fontSize: 12,
        }}
      >
        Demo data — no live profile or native file access
      </div>
      <main style={{ height: "calc(100dvh - 36px)" }}>
        <IconExplorerTab />
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
