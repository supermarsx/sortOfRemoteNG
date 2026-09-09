import {
  BriefcaseBusiness,
  Building2,
  ChartPie,
  CreditCard,
  Landmark,
  UsersRound,
} from "lucide-react";
import { defineIcon } from "./types";
import { ORGANIZATION_MARKER_ICONS } from "./organizationMarkers";
import { BUILDING_TYPE_ICONS } from "./buildingTypes";
import { EMPLOYEE_CARD_ICON } from "./identityCards";

/** Workplace/organization symbols retain their existing saved keys and artwork. */
export const BUSINESS_SHAPE_ICONS = [
  defineIcon("building", "Building", "business-shapes", Building2, [
    "building",
    "buildings",
    "premises",
    "site",
    "facility",
    "headquarters",
  ]),
  defineIcon("office", "Office", "business-shapes", BriefcaseBusiness, [
    "office",
    "workplace",
    "business",
    "branch",
    "department",
  ]),
  defineIcon("people", "People", "business-shapes", UsersRound, [
    "people",
    "persons",
    "users",
    "user group",
    "team",
    "staff",
    "employees",
  ]),
  defineIcon("corporate", "Corporate", "business-shapes", Landmark, [
    "corporate",
    "generic corporate",
    "company",
    "enterprise",
    "organization",
    "headquarters",
    "business",
  ]),
  defineIcon("payment-card", "Payment card", "business-shapes", CreditCard, [
    "payment card",
    "credit card",
    "pos",
    "point of sale",
    "payment",
    "plain",
  ]),
  defineIcon("pie-chart", "Pie chart", "business-shapes", ChartPie, [
    "pie chart",
    "business analytics",
    "business intelligence",
    "analytics",
    "reporting",
    "plain",
  ]),
  ...ORGANIZATION_MARKER_ICONS,
  ...BUILDING_TYPE_ICONS,
  EMPLOYEE_CARD_ICON,
] as const;
