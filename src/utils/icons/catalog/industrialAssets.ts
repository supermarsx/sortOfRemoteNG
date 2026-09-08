import {
  AirVent,
  AlarmSmoke,
  Boxes,
  Car,
  createLucideIcon,
  Fan,
  FireExtinguisher,
  Fingerprint,
  Gauge,
  MonitorCog,
  Nfc,
  PackageSearch,
  Projector,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Speaker,
  Thermometer,
  Utensils,
  Zap,
} from "lucide-react";

import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

const Stream = createLucideIcon("LiveStream", [
  ["path", { d: "m10 7 7 5-7 5V7Z", key: "play" }],
  [
    "path",
    {
      d: "M5 7a8 8 0 0 0 0 10M5 4a12 12 0 0 0 0 16M20 7a8 8 0 0 1 0 10",
      key: "broadcast",
    },
  ],
]);
const ProximitySensor = createLucideIcon("ProximitySensor", [
  [
    "rect",
    { x: "2", y: "6", width: "6", height: "12", rx: "1", key: "sensor-body" },
  ],
  [
    "path",
    {
      d: "M8 10h2M8 14h2M12 8a6 6 0 0 1 0 8M16 5a10 10 0 0 1 0 14M22 4v16",
      key: "detection-target",
    },
  ],
]);
const Motorcycle = createLucideIcon("Motorcycle", [
  ["circle", { cx: "5", cy: "17", r: "3", key: "rear-wheel" }],
  ["circle", { cx: "19", cy: "17", r: "3", key: "front-wheel" }],
  [
    "path",
    {
      d: "m5 17 4-7h5l-2 7H5Zm14 0-4-12h-3M15 5h4M6 9h5M14 10l-2 7h4",
      key: "engine-fork-seat",
    },
  ],
]);
const PaymentSystem = createLucideIcon("PaymentSystem", [
  [
    "rect",
    { x: "3", y: "3", width: "12", height: "18", rx: "2", key: "terminal" },
  ],
  [
    "path",
    {
      d: "M6 6h6v5H6ZM6 15h.01M9 15h.01M12 15h.01M6 18h.01M9 18h.01M12 18h.01M17 7a6 6 0 0 1 0 10M18 4a10 10 0 0 1 0 16",
      key: "keypad-contactless",
    },
  ],
]);
const PressureGauge = createLucideIcon("PressureGauge", [
  ["circle", { cx: "12", cy: "10", r: "7", key: "dial" }],
  [
    "path",
    {
      d: "m12 10 3-3M7 10h1M12 5v1M16 10h1M10 17v4h4v-4M8 21h8",
      key: "needle-pipe",
    },
  ],
]);
const LevelGauge = createLucideIcon("LevelGauge", [
  ["rect", { x: "5", y: "2", width: "14", height: "20", rx: "2", key: "tank" }],
  [
    "path",
    {
      d: "M5 12c3-3 4 3 7 0s4-3 7 0M9 6h2M9 9h2M9 16h2M9 19h2",
      key: "liquid-scale",
    },
  ],
]);
const PowerGauge = createLucideIcon("PowerGauge", [
  [
    "path",
    {
      d: "M4 19a10 10 0 1 1 16 0M3 12h2M7 5l1 2M17 5l-1 2M19 12h2",
      key: "meter",
    },
  ],
  ["path", { d: "m13 8-4 6h4l-2 6 5-8h-4l1-4Z", key: "electric-power" }],
]);
const MobileFleet = createLucideIcon("ManagedMobileFleet", [
  [
    "rect",
    { x: "8", y: "5", width: "9", height: "17", rx: "2", key: "front-device" },
  ],
  [
    "path",
    {
      d: "M5 18H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6M20 8h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-1M11 18h3m-4-6 2 2 3-4",
      key: "managed-fleet",
    },
  ],
]);
const ManagedMobile = createLucideIcon("ManagedMobile", [
  [
    "rect",
    { x: "6", y: "2", width: "12", height: "20", rx: "2", key: "phone" },
  ],
  ["path", { d: "M10 5h4M11 19h2m-4-7 2 2 4-4", key: "managed-check" }],
]);
const DigitalClock = createLucideIcon("DigitalClock", [
  [
    "rect",
    { x: "2", y: "5", width: "20", height: "14", rx: "2", key: "clock-case" },
  ],
  [
    "path",
    {
      d: "M5 8h4v8H5V8ZM15 8h4v8h-4V8ZM12 10h.01M12 14h.01",
      key: "digital-segments",
    },
  ],
]);
const RemoteDisplay = createLucideIcon("RemoteDisplay", [
  [
    "rect",
    { x: "2", y: "3", width: "20", height: "14", rx: "1", key: "screen" },
  ],
  [
    "path",
    {
      d: "M8 21h8M12 17v4M8 8a6 6 0 0 1 8 0M10 10a3 3 0 0 1 4 0M12 13h.01",
      key: "remote-link",
    },
  ],
]);
const DisplayWall = createLucideIcon("RemoteDisplayWall", [
  ["rect", { x: "2", y: "3", width: "20", height: "16", rx: "1", key: "wall" }],
  [
    "path",
    {
      d: "M12 3v16M2 11h20M7 22h10M7 7h.01M17 7h.01M7 15h.01M17 15h.01",
      key: "display-grid",
    },
  ],
]);
const CardReader = createLucideIcon("CardReader", [
  [
    "rect",
    { x: "3", y: "7", width: "18", height: "14", rx: "2", key: "reader" },
  ],
  [
    "path",
    {
      d: "M8 7V2h8v5M6 11h12M7 15h.01M10 15h.01M7 18h.01M10 18h.01M16 15h2v3h-2Z",
      key: "card-slot-controls",
    },
  ],
]);
const AnalogScreen = createLucideIcon("AnalogScreen", [
  [
    "rect",
    { x: "2", y: "4", width: "20", height: "16", rx: "3", key: "crt-case" },
  ],
  [
    "rect",
    {
      x: "5",
      y: "7",
      width: "12",
      height: "10",
      rx: "3",
      key: "curved-screen",
    },
  ],
  ["path", { d: "M19 9h.01M19 14h.01M8 20v2M16 20v2", key: "crt-controls" }],
]);
const AnalogController = createLucideIcon("AnalogController", [
  [
    "rect",
    { x: "2", y: "4", width: "20", height: "16", rx: "2", key: "panel" },
  ],
  ["circle", { cx: "9", cy: "12", r: "4", key: "rotary-dial" }],
  ["path", { d: "m9 12 2-2M17 8v8M15 10h4M15 15h4", key: "dial-slider" }],
]);
const TrafficLights = createLucideIcon("TrafficLights", [
  [
    "rect",
    { x: "8", y: "2", width: "8", height: "18", rx: "3", key: "housing" },
  ],
  ["circle", { cx: "12", cy: "6", r: "1", key: "stop" }],
  ["circle", { cx: "12", cy: "11", r: "1", key: "wait" }],
  ["circle", { cx: "12", cy: "16", r: "1", key: "go" }],
  [
    "path",
    {
      d: "M12 20v2M5 5l3 2M5 10l3 2M5 15l3 2M19 5l-3 2M19 10l-3 2M19 15l-3 2",
      key: "visors-pole",
    },
  ],
]);
const SpeakerArray = createLucideIcon("SpeakerArray", [
  [
    "rect",
    { x: "2", y: "3", width: "8", height: "18", rx: "1", key: "left-cabinet" },
  ],
  [
    "rect",
    {
      x: "14",
      y: "3",
      width: "8",
      height: "18",
      rx: "1",
      key: "right-cabinet",
    },
  ],
  ["circle", { cx: "6", cy: "14", r: "2", key: "left-woofer" }],
  ["circle", { cx: "18", cy: "14", r: "2", key: "right-woofer" }],
  ["path", { d: "M6 7h.01M18 7h.01", key: "tweeters" }],
]);
const OffgridController = createLucideIcon("OffgridController", [
  [
    "path",
    {
      d: "M3 10h18l-2 9H5l-2-9ZM9 10l1 9M15 10l-1 9M4 14h16M12 19v3M8 22h8",
      key: "solar-panel",
    },
  ],
  ["path", { d: "M9 7a3 3 0 0 1 6 0M12 1v1M6 3l1 1M18 3l-1 1", key: "sun" }],
]);
const GridController = createLucideIcon("GridController", [
  [
    "path",
    {
      d: "m12 2-6 20M12 2l6 20M8 8h8M5 12h14M8 18h8M5 12v4M19 12v4M9 8l6 10M15 8 9 18",
      key: "grid-pylon",
    },
  ],
]);
const MiniServer = createLucideIcon("MiniServer", [
  [
    "rect",
    { x: "4", y: "5", width: "16", height: "14", rx: "4", key: "mini-case" },
  ],
  [
    "path",
    { d: "M7 10h10M7 14h4M16 14h.01M8 19v2M16 19v2", key: "ports-feet" },
  ],
]);
const MiniTower = createLucideIcon("MiniServerTower", [
  [
    "rect",
    { x: "7", y: "2", width: "10", height: "20", rx: "2", key: "tower-case" },
  ],
  ["path", { d: "M10 6h4M10 9h4M10 12h4M12 18h.01", key: "tower-vents" }],
]);
const MiniRack = createLucideIcon("MiniServerRack", [
  [
    "rect",
    { x: "2", y: "7", width: "20", height: "10", rx: "1", key: "half-rack" },
  ],
  [
    "path",
    {
      d: "M5 7v10M19 7v10M8 10h4v4H8ZM15 10h.01M15 14h.01M3.5 12h.01M20.5 12h.01",
      key: "rack-controls",
    },
  ],
]);
const MiniCluster = createLucideIcon("MiniServerCluster", [
  [
    "rect",
    { x: "2", y: "3", width: "8", height: "7", rx: "1", key: "node-one" },
  ],
  [
    "rect",
    { x: "14", y: "3", width: "8", height: "7", rx: "1", key: "node-two" },
  ],
  [
    "rect",
    { x: "8", y: "15", width: "8", height: "7", rx: "1", key: "node-three" },
  ],
  [
    "path",
    { d: "M6 10v3h12v-3M12 13v2M5 7h2M17 7h2M11 19h2", key: "cluster-links" },
  ],
]);
const AccessControl = createLucideIcon("AccessControl", [
  [
    "path",
    {
      d: "M3 22V2h12v20M10 12h.01M18 9v8m-3-4 3 4 4-6",
      key: "controlled-door",
    },
  ],
]);
const KeypadAccess = createLucideIcon("KeypadAccess", [
  [
    "rect",
    { x: "5", y: "2", width: "14", height: "20", rx: "2", key: "keypad-case" },
  ],
  [
    "path",
    {
      d: "M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01",
      key: "access-keypad",
    },
  ],
]);

/** Physical devices and controls; these are palette choices, not integrations. */
export const INDUSTRIAL_ASSET_ICONS = [
  defineIcon("stream", "Live stream", "servers-devices", Stream, [
    "stream",
    "streaming",
    "broadcast",
    "video",
    "live feed",
  ]),
  defineIcon(
    "stream-server",
    "Stream server",
    "servers-devices",
    createRoleIcon("StreamServer", "server", Stream),
    [
      "stream server",
      "streamserver",
      "streaming server",
      "media server",
      "broadcast",
    ],
  ),
  defineIcon("sensor", "Sensor", "servers-devices", Radio, [
    "sensor",
    "sensors",
    "telemetry",
    "iot measurement",
  ]),
  defineIcon("vehicle", "Vehicle", "servers-devices", Car, [
    "vehicle",
    "vehicles",
    "car",
    "fleet",
    "transport",
  ]),
  defineIcon("inventory", "Inventory", "servers-devices", PackageSearch, [
    "inventory",
    "assets",
    "item tracking",
    "warehouse management",
  ]),
  defineIcon("stock", "Stock", "servers-devices", Boxes, [
    "stock",
    "stockroom",
    "goods",
    "inventory quantities",
  ]),
  defineIcon("restaurant", "Restaurant", "servers-devices", Utensils, [
    "restaurant",
    "restaurants",
    "food service",
    "dining",
  ]),
  defineIcon(
    "proximity-sensor",
    "Proximity sensor",
    "servers-devices",
    ProximitySensor,
    [
      "proximity sensor",
      "proximitysensor",
      "distance",
      "presence detection",
      "inductive",
    ],
  ),
  defineIcon("motorcycle", "Motorcycle", "servers-devices", Motorcycle, [
    "motorcycle",
    "motorbike",
    "two wheeler",
  ]),
  defineIcon("rfid", "RFID", "servers-devices", Nfc, [
    "rfid",
    "nfc",
    "radio frequency identification",
    "contactless tag",
  ]),
  defineIcon(
    "payment-system",
    "Payment system",
    "servers-devices",
    PaymentSystem,
    ["payment system", "paymentsystem", "payments", "card terminal", "eftpos"],
  ),
  defineIcon("hvac", "HVAC", "servers-devices", AirVent, [
    "hvac",
    "heating",
    "ventilation",
    "air conditioning",
    "climate control",
  ]),
  defineIcon(
    "temperature-gauge",
    "Temperature gauge",
    "servers-devices",
    Thermometer,
    ["temperature gauge", "temperaturegauge", "thermometer", "thermal sensor"],
  ),
  defineIcon(
    "pressure-gauge",
    "Pressure gauge",
    "servers-devices",
    PressureGauge,
    ["pressure gauge", "manometer", "bar", "psi", "gauges"],
  ),
  defineIcon("level-gauge", "Level gauge", "servers-devices", LevelGauge, [
    "level gauge",
    "liquid level",
    "tank",
    "gauges",
  ]),
  defineIcon("speed-gauge", "Speed gauge", "servers-devices", Gauge, [
    "speed gauge",
    "speedometer",
    "rpm",
    "gauges",
  ]),
  defineIcon("power-gauge", "Power gauge", "servers-devices", PowerGauge, [
    "power gauge",
    "electric meter",
    "wattmeter",
    "gauges",
  ]),
  defineIcon("mdm", "Mobile device management", "servers-devices", MonitorCog, [
    "mdm",
    "generic mdm",
    "mobile device management",
    "endpoint management",
  ]),
  defineIcon(
    "mdm-mobile",
    "Managed mobile device",
    "servers-devices",
    ManagedMobile,
    ["mdm mobile", "mobile device management", "managed phone", "mdm variant"],
  ),
  defineIcon(
    "mdm-fleet",
    "Managed device fleet",
    "servers-devices",
    MobileFleet,
    [
      "mdm fleet",
      "mobile device management",
      "device collection",
      "mdm variant",
    ],
  ),
  defineIcon(
    "digital-clock",
    "Digital clock",
    "servers-devices",
    DigitalClock,
    ["digital clock", "digitalclock", "electronic clock", "time display"],
  ),
  defineIcon(
    "remote-display",
    "Remote display",
    "servers-devices",
    RemoteDisplay,
    [
      "remote display",
      "remote screen",
      "digital signage",
      "display collection",
    ],
  ),
  defineIcon(
    "remote-display-wall",
    "Remote display wall",
    "servers-devices",
    DisplayWall,
    [
      "remote display wall",
      "video wall",
      "screens collection",
      "display collection",
    ],
  ),
  defineIcon(
    "remote-projector",
    "Remote projector",
    "servers-devices",
    Projector,
    ["remote projector", "remote display", "projection", "display collection"],
  ),
  defineIcon("card-reader", "Card reader", "servers-devices", CardReader, [
    "card reader",
    "cardreader",
    "smart card",
    "magnetic stripe",
  ]),
  defineIcon("high-voltage", "High voltage", "servers-devices", Zap, [
    "high voltage",
    "highvoltage",
    "electrical hazard",
    "electricity",
  ]),
  defineIcon("safety-system", "Safety system", "servers-devices", ShieldCheck, [
    "safety system",
    "safety systems",
    "safety interlock",
    "protection",
  ]),
  defineIcon("alarm", "Alarm", "servers-devices", AlarmSmoke, [
    "alarm",
    "alarms",
    "smoke detector",
    "fire alarm",
  ]),
  defineIcon(
    "fire-extinguisher",
    "Fire extinguisher",
    "servers-devices",
    FireExtinguisher,
    ["fire extinguisher", "fireextinguisher", "fire safety"],
  ),
  defineIcon(
    "analog-screen",
    "Analog screen",
    "servers-devices",
    AnalogScreen,
    ["analog screen", "analogscreen", "analogue", "crt", "legacy monitor"],
  ),
  defineIcon(
    "analog-controller",
    "Analog controller",
    "servers-devices",
    AnalogController,
    ["analog controller", "analogcontroller", "analogue", "rotary control"],
  ),
  defineIcon("controller", "Controller", "servers-devices", SlidersHorizontal, [
    "controller",
    "generic controller",
    "control panel",
    "automation",
  ]),
  defineIcon(
    "traffic-lights",
    "Traffic lights",
    "servers-devices",
    TrafficLights,
    ["traffic lights", "trafficlights", "traffic signal", "stoplight"],
  ),
  defineIcon("speaker", "Speaker", "servers-devices", Speaker, [
    "speaker",
    "speakers",
    "audio",
    "sound system",
  ]),
  defineIcon(
    "speaker-array",
    "Speaker collection",
    "servers-devices",
    SpeakerArray,
    [
      "speaker array",
      "speakers collection",
      "speaker collection",
      "stereo",
      "pa system",
    ],
  ),
  defineIcon(
    "offgrid-controller",
    "Off-grid controller",
    "servers-devices",
    OffgridController,
    [
      "offgrid controller",
      "off grid controller",
      "offgridcontroller",
      "solar charge controller",
      "renewable",
    ],
  ),
  defineIcon(
    "grid-controller",
    "Grid controller",
    "servers-devices",
    GridController,
    [
      "grid controller",
      "grid controllers",
      "gridcontrollers",
      "electrical grid",
      "utility control",
    ],
  ),
  defineIcon("fan", "Fan", "servers-devices", Fan, [
    "fan",
    "fans",
    "cooling",
    "ventilation",
  ]),
  defineIcon("mini-server", "Mini server", "servers-devices", MiniServer, [
    "mini server",
    "miniserver",
    "mini pc",
    "compact server",
  ]),
  defineIcon(
    "mini-server-tower",
    "Mini tower server",
    "servers-devices",
    MiniTower,
    ["mini server tower", "miniserver", "mini server variant", "compact tower"],
  ),
  defineIcon(
    "mini-server-rack",
    "Mini rack server",
    "servers-devices",
    MiniRack,
    [
      "mini server rack",
      "miniserver",
      "mini server variant",
      "half width rack",
    ],
  ),
  defineIcon(
    "mini-server-cluster",
    "Mini server cluster",
    "servers-devices",
    MiniCluster,
    [
      "mini server cluster",
      "miniserver",
      "mini server variant",
      "compact compute cluster",
    ],
  ),
  defineIcon(
    "access-control",
    "Access control",
    "servers-devices",
    AccessControl,
    ["access control", "accesscontrol", "door access", "entry system"],
  ),
  defineIcon(
    "access-control-keypad",
    "Keypad access control",
    "servers-devices",
    KeypadAccess,
    [
      "access control keypad",
      "pin entry",
      "door keypad",
      "access control variant",
    ],
  ),
  defineIcon(
    "access-control-biometric",
    "Biometric access control",
    "servers-devices",
    createRoleIcon("BiometricAccessControl", "wall-terminal", Fingerprint),
    [
      "access control biometric",
      "fingerprint reader",
      "access control variant",
    ],
  ),
  defineIcon(
    "access-control-rfid",
    "RFID access control",
    "servers-devices",
    createRoleIcon("RFIDAccessControl", "wall-terminal", Nfc),
    ["access control rfid", "contactless entry", "access control variant"],
  ),
] as const;
