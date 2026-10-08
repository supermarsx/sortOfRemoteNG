import { createLucideIcon } from "lucide-react";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

// Local Simple Icons 16.28.0 (CC0) vectors. No runtime package or network lookup.
// Sources: https://www.elegoo.com/pages/download and https://bambulab.com
const Elegoo = createLucideIcon("ElegooPrinterEmblem", [
  [
    "path",
    {
      d: "M12.686 7.479c.54.829 1.032 1.665 1.476 2.505.64-1.217 1.849-2.086 3.328-2.086 2.217 0 3.826 1.954 3.826 4.102 0 2.149-1.609 4.102-3.826 4.102-.656 0-1.26-.171-1.784-.467l-.001-.001c-.635-.36-1.153-.905-1.509-1.553-.484-.804-.725-1.706-.991-2.657-.598-2.134-1.252-3.773-3.194-4.988-1.001-.626-2.196-.985-3.501-.985C2.815 5.451 0 8.323 0 12c0 3.727 2.761 6.549 6.51 6.549 1.955 0 3.639-.766 4.805-2.027-.543-.83-1.034-1.664-1.477-2.505-.641 1.217-1.849 2.085-3.328 2.085-2.218 0-3.827-1.953-3.827-4.102 0-2.148 1.609-4.102 3.827-4.102.655 0 1.26.171 1.783.469h.001c.635.36 1.154.904 1.509 1.553.574.951.807 2.041 1.144 3.188.555 1.89 1.285 3.339 3.002 4.432 1.008.642 2.217 1.009 3.541 1.009 3.694 0 6.51-2.872 6.51-6.549 0-3.727-2.76-6.549-6.51-6.549-1.954 0-3.64.766-4.804 2.028Z",
      fill: "currentColor",
      stroke: "none",
      key: "elegoo",
    },
  ],
]);
const BambuLab = createLucideIcon("BambuLabPrinterEmblem", [
  [
    "path",
    {
      d: "M12.662 24V8.959l8.535 3.369V24zm-9.859-.003v-7.521l8.534-3.371-.001 10.892zM2.803 0h8.533l.001 11.672-8.534 3.369zm9.859 0h8.535v10.892l-8.535-3.371z",
      fill: "currentColor",
      stroke: "none",
      key: "bambu-lab",
    },
  ],
]);

export const MAKER_PRINTER_ICONS = [
  defineIcon(
    "elegoo",
    "Elegoo",
    "vendors-hardware",
    Elegoo,
    ["elegoo", "printer", "3d printing", "filament", "resin"],
    "Elegoo mark from Simple Icons 16.28.0 (CC0).",
  ),
  defineIcon(
    "bambu-lab",
    "Bambu Lab",
    "vendors-hardware",
    BambuLab,
    ["bambu lab", "bambulab", "bambu", "bamboo", "printer", "3d printing"],
    "Bambu Lab mark from Simple Icons 16.28.0 (CC0).",
  ),
  defineIcon(
    "elegoo-printer",
    "Elegoo printer",
    "vendors-hardware",
    createRoleIcon("ElegooPrinter", "printer", Elegoo),
    ["elegoo", "printer", "3d printing", "filament", "resin"],
    "Elegoo mark from Simple Icons 16.28.0 (CC0), inside an app-authored printer frame.",
  ),
  defineIcon(
    "bambu-lab-printer",
    "Bambu Lab printer",
    "vendors-hardware",
    createRoleIcon("BambuLabPrinter", "printer", BambuLab),
    [
      "bambu lab",
      "bambulab",
      "bambu",
      "bamboo",
      "bamboo lab",
      "printer",
      "3d printing",
      "filament",
    ],
    "Bambu Lab mark from Simple Icons 16.28.0 (CC0), inside an app-authored printer frame.",
  ),
] as const;
