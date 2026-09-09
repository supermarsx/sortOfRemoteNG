import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

const EmployeeCard = createLucideIcon("EmployeeIdentityCard", [
  [
    "path",
    {
      d: "M9 5H3v17h18V5h-6M9 2h6v5H9ZM13 11h5M13 15h5M13 18h3M5 18v-1a3 3 0 0 1 6 0v1",
      key: "card-clip-details",
    },
  ],
  ["circle", { cx: "8", cy: "11", r: "2", key: "portrait" }],
]);
const ContactlessCreditCard = createLucideIcon("ContactlessCreditCard", [
  ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "3", key: "card" }],
  [
    "path",
    {
      d: "M5 8h6v5H5ZM8 8v5M5 10.5h6M15 9a3 3 0 0 1 0 4M17 7a6 6 0 0 1 0 8M5 17h3M10 17h3",
      key: "chip-contactless-details",
    },
  ],
]);

export const EMPLOYEE_CARD_ICON = defineIcon(
  "employee-card",
  "Employee identity card",
  "generic-shapes",
  EmployeeCard,
  [
    "employee card",
    "employee",
    "staff",
    "id card",
    "identity",
    "badge",
    "access card",
  ],
);
export const CREDIT_CARD_ICON = defineIcon(
  "credit-card-contactless",
  "Contactless credit card",
  "web-applications",
  ContactlessCreditCard,
  ["credit card", "payment card", "contactless", "banking", "finance", "nfc"],
);
