import {
  Building2,
  createLucideIcon,
  Factory,
  Hospital,
  Hotel,
  House,
  Landmark,
  School,
  Store,
  Warehouse,
} from "lucide-react";

import { defineIcon } from "./types";
import { mcdonalds } from "../brand";

const Supermarket = createLucideIcon("SupermarketBuilding", [
  [
    "path",
    {
      d: "M2 8h20l-2-5H4L2 8ZM3 8v13h18V8M7 3 6 8M12 3v5M17 3l1 5",
      key: "wide-storefront",
    },
  ],
  [
    "path",
    { d: "M6 12h2l1 5h7l2-4H8M10 19h.01M16 19h.01", key: "shopping-cart" },
  ],
]);
const OfficeBuilding = createLucideIcon("OfficeBuilding", [
  [
    "path",
    {
      d: "M4 22V5l12-3v20M16 10h4v12M2 22h20M8 7h1M12 6h1M8 11h1M12 10h1M8 15h1M12 14h1M9 22v-4h3v4",
      key: "office-tower",
    },
  ],
]);
const RestaurantBuilding = createLucideIcon("RestaurantBuilding", [
  [
    "path",
    {
      d: "M2 8 12 2l10 6M4 7v15h16V7M8 10v4m-2-4v2a2 2 0 0 0 4 0v-2M8 14v4M16 10v8m0-8c-3 1-3 5 0 5",
      key: "restaurant-facade-cutlery",
    },
  ],
]);
const BankBuilding = createLucideIcon("BankBuilding", [
  [
    "path",
    { d: "m2 7 10-5 10 5H2ZM4 10v10M20 10v10M2 22h20", key: "bank-facade" },
  ],
  [
    "rect",
    { x: "8", y: "10", width: "8", height: "10", rx: "1", key: "vault-door" },
  ],
  ["circle", { cx: "12", cy: "15", r: "2", key: "vault-wheel" }],
]);
const DatacenterBuilding = createLucideIcon("DatacenterBuilding", [
  ["path", { d: "M2 22V5h20v17M7 5V2h10v3M1 22h22", key: "datacenter-shell" }],
  [
    "path",
    {
      d: "M5 9h5v10H5V9ZM14 9h5v10h-5V9ZM5 12h5M5 15h5M14 12h5M14 15h5",
      key: "equipment-rows",
    },
  ],
]);
const GarageBuilding = createLucideIcon("GarageBuilding", [
  [
    "path",
    {
      d: "m2 8 10-6 10 6v14H2V8ZM5 22V10h14v12M5 13h14M5 16h14M5 19h14",
      key: "garage-shutter",
    },
  ],
]);

/** Physical premises, distinct from the company-industry marker collection. */
export const BUILDING_TYPE_ICONS = [
  defineIcon(
    "storefront",
    "Storefront",
    "business-shapes",
    Store,
    [
      "storefront",
      "store front",
      "shopfront",
      "shop front",
      "retail",
      "shop",
      "store",
      "loja",
    ],
    "Generic shop facade; not a brand or Citrix StoreFront service.",
  ),
  defineIcon(
    "mcdonalds",
    "McDonald's",
    "business-shapes",
    mcdonalds,
    [
      "mcdonalds",
      "mcdonald's",
      "mcdonald",
      "golden arches",
      "restaurant",
      "fast food",
    ],
    "McDonald's Golden Arches from the pinned Simple Icons collection, without a background tile.",
  ),
  defineIcon("warehouse", "Warehouse", "business-shapes", Warehouse, [
    "warehouse",
    "warehouse building",
    "distribution center",
    "storage facility",
  ]),
  defineIcon("building-store", "Store building", "business-shapes", Store, [
    "building store",
    "stores",
    "shop",
    "retail premises",
  ]),
  defineIcon(
    "building-supermarket",
    "Supermarket building",
    "business-shapes",
    Supermarket,
    ["building supermarket", "grocery store", "supermarket", "retail"],
  ),
  defineIcon(
    "building-office",
    "Office building",
    "business-shapes",
    OfficeBuilding,
    ["building office", "office building", "business premises", "headquarters"],
  ),
  defineIcon(
    "building-hospital",
    "Hospital building",
    "business-shapes",
    Hospital,
    ["building hospital", "hospital", "medical center", "clinic"],
  ),
  defineIcon("building-school", "School building", "business-shapes", School, [
    "building school",
    "school",
    "education campus",
  ]),
  defineIcon("building-hotel", "Hotel building", "business-shapes", Hotel, [
    "building hotel",
    "hotel",
    "accommodation",
  ]),
  defineIcon(
    "building-restaurant",
    "Restaurant building",
    "business-shapes",
    RestaurantBuilding,
    ["building restaurant", "restaurant premises", "dining venue"],
  ),
  defineIcon(
    "building-factory",
    "Factory building",
    "business-shapes",
    Factory,
    ["building factory", "factory", "manufacturing plant"],
  ),
  defineIcon("building-house", "House", "business-shapes", House, [
    "building house",
    "house",
    "residential home",
  ]),
  defineIcon(
    "building-apartment",
    "Apartment building",
    "business-shapes",
    Building2,
    ["building apartment", "apartment", "residential block", "flats"],
  ),
  defineIcon(
    "building-bank",
    "Bank building",
    "business-shapes",
    BankBuilding,
    ["building bank", "bank branch", "financial institution"],
  ),
  defineIcon(
    "building-government",
    "Government building",
    "business-shapes",
    Landmark,
    [
      "building government",
      "government offices",
      "town hall",
      "civic building",
    ],
  ),
  defineIcon(
    "building-datacenter",
    "Datacenter building",
    "business-shapes",
    DatacenterBuilding,
    ["building datacenter", "data center", "server facility", "colocation"],
  ),
  defineIcon(
    "building-garage",
    "Garage building",
    "business-shapes",
    GarageBuilding,
    ["building garage", "garage", "workshop", "vehicle depot"],
  ),
] as const;
