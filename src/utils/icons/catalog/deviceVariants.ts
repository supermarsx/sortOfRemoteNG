import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

const symbol = (name: string, ...paths: string[]) =>
  createLucideIcon(
    name,
    paths.map((d, index) => ["path", { d, key: `part-${index}` }]),
  );

/** Additional pure asset silhouettes; existing saved device keys are untouched. */
export const DEVICE_VARIANT_ICONS = [
  defineIcon(
    "display-multi-screen",
    "Multi-screen display array",
    "servers-devices",
    symbol(
      "MultiScreenDisplayArray",
      "M7 3h10v9H7ZM1 5h4v9H1ZM19 5h4v9h-4ZM3 14v3h18v-3M12 12v9M7 22h10",
    ),
    [
      "multi-screen",
      "multi screen",
      "multiscreen",
      "multiple monitors",
      "triple monitor",
      "three screens",
      "display",
      "monitor",
    ],
  ),
  defineIcon(
    "restaurant-table",
    "Restaurant dining table",
    "servers-devices",
    symbol(
      "RestaurantDiningTable",
      "M5 12h14v3H5ZM8 15v7M16 15v7M2 8v10h3M22 8v10h-3M8 9h8M10 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    ),
    ["restaurant", "restaurants", "dining", "table", "food service"],
  ),
  defineIcon(
    "stock-shelves",
    "Stockroom shelving",
    "servers-devices",
    symbol(
      "StockroomShelving",
      "M2 2v20M22 2v20M2 11h20M2 20h20M5 3h6v8H5ZM14 5h5v6h-5ZM5 14h5v6H5ZM13 13h6v7h-6ZM7 3v3M16 5v2M15 13v2",
    ),
    ["stock", "stockroom", "inventory", "warehouse", "shelves", "storage"],
  ),
  defineIcon(
    "motorcycle-cruiser",
    "Cruiser motorcycle",
    "servers-devices",
    symbol(
      "CruiserMotorcycle",
      "M2 17a3 3 0 1 0 6 0 3 3 0 1 0-6 0M16 17a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5 17l3-5h4l3 5H5M3 11h6l2 2h4M19 17l-5-12h4M14 5l-2 3M13 10h4M8 17l2-4",
    ),
    ["motorcycle", "cruiser", "motorbike", "bike", "vehicle"],
  ),
  defineIcon(
    "server-tower-vented",
    "Vented tower server",
    "servers-devices",
    symbol(
      "VentedTowerServer",
      "M5 2h14v20H5ZM5 7h14M8 4h.01M12 4h4M8 10v3M11 10v3M14 10v3M17 10v3M9 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 15v6M9 18h6",
    ),
    ["tower server", "server tower", "vented", "chassis", "server"],
  ),
  defineIcon(
    "server-blade-horizontal",
    "Horizontal blade server",
    "servers-devices",
    symbol(
      "HorizontalBladeServer",
      "M2 2h20v20H2ZM5 4h14v4H5ZM5 10h14v4H5ZM5 16h14v4H5ZM7 6h6M7 12h6M7 18h6M16 6h.01M16 12h.01M16 18h.01",
    ),
    ["blade server", "server blade", "horizontal", "chassis", "server"],
  ),
  defineIcon(
    "development-workstation-dual",
    "Dual-screen development workstation",
    "servers-devices",
    symbol(
      "DualDevelopmentWorkstation",
      "M1 3h10v11H1ZM13 3h10v11H13ZM6 14v3M18 14v3M3 17h18M3 20h18v2H3ZM5 6 3 8l2 2M7 6l2 2-2 2M15 6h6M15 9h4",
    ),
    [
      "development workstation",
      "dev workstation",
      "dual screen",
      "developer",
      "coding",
      "workstation",
    ],
  ),
  defineIcon(
    "workstation-desktop",
    "Desktop workstation and tower",
    "servers-devices",
    symbol(
      "DesktopWorkstationTower",
      "M1 3h15v11H1ZM8 14v4M4 18h8M18 2h5v20h-5ZM19 6h3M19 9h3M20 17h.01M1 21h15",
    ),
    ["workstation", "desktop", "computer", "pc", "tower"],
  ),
  defineIcon(
    "server-rack-open",
    "Open-frame rack server",
    "servers-devices",
    symbol(
      "OpenFrameRackServer",
      "M3 2v20M21 2v20M1 22h6M17 22h6M3 3h18M5 6h14v5H5ZM5 14h14v5H5ZM7 8h.01M10 8h6M7 16h.01M10 16h6M3 11h2M19 11h2M3 19h2M19 19h2",
    ),
    ["rack server", "server rack", "open frame", "rackmount", "server"],
  ),
  defineIcon(
    "printer-laser",
    "Laser printer with output tray",
    "servers-devices",
    symbol(
      "LaserPrinterTray",
      "M6 8V2h12v6M9 5h6M2 8h20v11h-5M7 19H2M6 13h12l-2 9H8ZM9 17h6M10 19h4M18 11h.01M4 11h4",
    ),
    ["printer", "printers", "laser", "printing", "output tray"],
  ),
  defineIcon(
    "display-ultrawide",
    "Ultrawide curved display",
    "servers-devices",
    symbol(
      "UltrawideCurvedDisplay",
      "M1 3c7 3 15 3 22 0v12c-7-2-15-2-22 0ZM12 14v6M7 22l5-2 5 2M4 7v4M20 7v4",
    ),
    ["display", "monitor", "ultrawide", "curved", "screen"],
  ),
] as const;
