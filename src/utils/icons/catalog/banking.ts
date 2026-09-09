import {
  Banknote,
  Coins,
  createLucideIcon,
  Landmark,
  Vault,
} from "lucide-react";
import { defineIcon } from "./types";
import { CREDIT_CARD_ICON } from "./identityCards";

const BankAccount = createLucideIcon("BankAccount", [
  [
    "path",
    {
      d: "M4 3h15a1 1 0 0 1 1 1v17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M3 17h17M8 11h8M8 14h5",
      key: "account-book",
    },
  ],
  ["circle", { cx: "12", cy: "7", r: "2", key: "account-holder" }],
]);
const BankTransfer = createLucideIcon("BankTransfer", [
  ["path", { d: "m3 7 9-5 9 5H3ZM5 7v6M10 7v6M15 7v6M20 7v6", key: "bank" }],
  [
    "path",
    { d: "M3 16h17m-3-3 3 3-3 3M21 21H4m3-3-3 3", key: "transfer-directions" },
  ],
]);
const BankAtm = createLucideIcon("BankATM", [
  [
    "rect",
    { x: "3", y: "2", width: "18", height: "20", rx: "2", key: "atm-case" },
  ],
  [
    "path",
    {
      d: "M6 5h12v6H6ZM6 14h.01M9 14h.01M6 17h.01M9 17h.01M13 14h5v5h-5ZM14 17h3",
      key: "screen-keypad-cash",
    },
  ],
]);

/** Generic banking identifiers; card symbols carry no bank or issuer branding. */
export const BANKING_ICONS = [
  CREDIT_CARD_ICON,
  defineIcon("banking", "Banking", "web-applications", Landmark, [
    "banking",
    "bank",
    "banks",
    "finance",
    "financial institution",
  ]),
  defineIcon("bank-account", "Bank account", "web-applications", BankAccount, [
    "bank account",
    "banking account",
    "account balance",
    "passbook",
    "iban",
  ]),
  defineIcon(
    "bank-transfer",
    "Bank transfer",
    "web-applications",
    BankTransfer,
    [
      "bank transfer",
      "banking transfer",
      "wire transfer",
      "sepa",
      "remittance",
    ],
  ),
  defineIcon("bank-cash", "Banknotes", "web-applications", Banknote, [
    "bank cash",
    "banking cash",
    "cash",
    "banknotes",
    "money",
    "currency",
  ]),
  defineIcon("bank-coins", "Coins", "web-applications", Coins, [
    "bank coins",
    "banking coins",
    "coins",
    "money",
    "savings",
  ]),
  defineIcon("bank-safe", "Bank safe", "web-applications", Vault, [
    "bank safe",
    "banking safe",
    "safe",
    "bank vault",
    "cash storage",
  ]),
  defineIcon("bank-atm", "ATM", "web-applications", BankAtm, [
    "bank atm",
    "banking atm",
    "atm",
    "cash machine",
    "cashpoint",
    "automated teller",
  ]),
] as const;
