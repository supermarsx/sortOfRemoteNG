import { createLucideIcon } from "lucide-react";
import { claranet, sapo } from "../brand";
import { TELECOM_ICONS } from "./telecom";
import { defineIcon } from "./types";

/** Network-access and telecom providers. DNS/registrars and hosting have their own categories. */
export const ISP_PROVIDER_ICONS = [
  ...TELECOM_ICONS,
  defineIcon(
    "isp",
    "Internet service provider",
    "isp-providers",
    createLucideIcon("InternetServiceProvider", [
      ["circle", { cx: "12", cy: "7", r: "5", key: "internet" }],
      [
        "path",
        {
          d: "M7 7h10M12 2c-3 3-3 7 0 10 3-3 3-7 0-10M12 12v4M4 16h16M4 16v3M12 16v3M20 16v3M2 19h4v3H2ZM10 19h4v3h-4ZM18 19h4v3h-4Z",
          key: "distribution",
        },
      ],
    ]),
    [
      "isp",
      "generic isp",
      "internet service provider",
      "internet provider",
      "broadband",
      "network access",
    ],
  ),
  defineIcon(
    "sapo",
    "SAPO",
    "isp-providers",
    sapo,
    [
      "sapo",
      "sapo.pt",
      "sapo portugal",
      "portal",
      "portugal",
      "internet provider",
    ],
    "SAPO publisher frog emblem, extracted from its 2025 wordmark and rendered in monochrome; portal/provider identification, not a connectivity claim.",
  ),
  defineIcon(
    "cogent",
    "Cogent Communications",
    "isp-providers",
    createLucideIcon("CogentCommunicationsIdentifier", [
      [
        "path",
        {
          d: "M11 4H7a5 5 0 0 0-5 5v6a5 5 0 0 0 5 5h4M22 4h-4a5 5 0 0 0-5 5v6a5 5 0 0 0 5 5h4M6 9v6M17 9v6",
          key: "cc",
        },
      ],
    ]),
    [
      "cogent",
      "cogent communications",
      "cogentco.com",
      "as174",
      "transit",
      "isp",
    ],
    "Cogent Communications app-authored initials identifier; not an official logo.",
  ),
  defineIcon("claranet", "Claranet", "isp-providers", claranet, [
    "claranet",
    "clara net",
    "claranet.com",
    "claranet.pt",
    "isp",
    "managed services",
    "hosting",
  ]),
] as const;
