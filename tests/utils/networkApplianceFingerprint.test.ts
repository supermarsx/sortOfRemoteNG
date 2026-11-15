import { describe, expect, it } from "vitest";
import { fingerprintService } from "../../src/utils/discovery/serviceFingerprint";
import {
  identifyNetworkAppliance,
  identifyYealinkSip,
} from "../../src/utils/discovery/networkApplianceFingerprint";

// Hand-written synthetic fixtures; no vendor firmware or captures.
const http = (evidence: Record<string, unknown>, banner?: string) =>
  fingerprintService(443, banner, undefined, {
    http_status: 200,
    httpScheme: "https",
    ...evidence,
  });

describe("OPNsense fingerprints", () => {
  it.each([
    "OPNsense",
    "OPNsense - Login",
    "Login | OPNsense",
    "fw01.example.lan | Lobby: Dashboard | OPNsense",
  ])("recognizes title %s", (title) => {
    const service = http({ http_title: title });
    expect(service.product).toBe("OPNsense");
    expect(service.version).toBeUndefined();
    expect(service.detection).toBe("identified");
  });

  it("recognizes the UI theme asset path in a body", () => {
    const body =
      '<html><head><link rel="shortcut icon" href="/ui/themes/opnsense/build/images/favicon.png"></head></html>';
    expect(identifyNetworkAppliance({ text: body })?.product).toBe("OPNsense");
  });

  it.each([
    "pfSense - Login",
    "pfSense",
    "OPNsense alternatives",
    "Why I moved from pfSense to OPNsense",
    "FreeBSD",
  ])("does not claim OPNsense for %s", (title) => {
    expect(http({ http_title: title }).product).not.toBe("OPNsense");
    expect(identifyNetworkAppliance({ title })?.product === "OPNsense").toBe(
      false,
    );
  });

  it("does not treat pfSense assets or a FreeBSD SSH banner as OPNsense", () => {
    expect(
      identifyNetworkAppliance({
        text: '<link href="/css/pfSense.css"><script src="/js/pfSense.js">',
      }),
    ).toBeUndefined();
    expect(
      fingerprintService(22, "SSH-2.0-OpenSSH_9.7 FreeBSD-20240701").product,
    ).toBe("OpenSSH");
  });
});

describe("TP-Link fingerprints", () => {
  it.each([
    ["TP-LINK Wireless N Router WR841N", "WR841N"],
    ["TP-Link Gigabit VPN Router ER605", "ER605"],
    ["TP-LINK JetStream Switch TL-SG2008", "TL-SG2008"],
    ["Archer C7", "Archer C7"],
    ["Archer AX55 (EU)", "Archer AX55"],
    ["TL-SG108E", "TL-SG108E"],
    ["TP-Link Deco M5", "Deco M5"],
  ])("recognizes title %s and extracts model", (title, model) => {
    const service = http({ http_title: title });
    expect(service.product).toBe("TP-Link");
    expect(service.evidence).toContain(`model hint ${model}`);
    expect(service.version).toBeUndefined();
  });

  it.each(["Omada Controller", "Omada Software Controller - Login"])(
    "recognizes Omada title %s",
    (title) => {
      expect(http({ http_title: title }).product).toBe("TP-Link Omada");
    },
  );

  it("recognizes a TP-LINK Server header", () => {
    expect(
      http({ http_title: undefined, http_server: "TP-LINK HTTPD/1.0" }).product,
    ).toBe("TP-Link");
  });

  it("recognizes the Basic realm only on a 401 challenge", () => {
    const challenged = http({
      http_status: 401,
      http_basic_realm: "TP-LINK Wireless N Router WR740N",
    });
    expect(challenged.product).toBe("TP-Link");
    expect(challenged.evidence).toContain("model hint WR740N");
    expect(
      http({
        http_status: 200,
        http_basic_realm: "TP-LINK Wireless N Router WR740N",
      }).product,
    ).toBeUndefined();
  });

  it.each([
    "http://tplinkwifi.net",
    "http://tplinklogin.net:80",
    "http://tplinkmodem.net",
  ])("recognizes the setup hostname redirect to %s", (finalOrigin) => {
    expect(
      http({ http_final_origin: finalOrigin, http_title: "Login" }).product,
    ).toBe("TP-Link");
  });

  it.each([
    ["title", { http_title: "TP-Link alternatives" }],
    ["title", { http_title: "Router" }],
    ["title", { http_title: "Omada alternatives" }],
    ["title", { http_title: "Deco" }],
    ["title", { http_title: "Archer" }],
    ["server", { http_server: "Router Webserver" }],
    ["server", { http_server: "NotTP-LINK" }],
    ["realm", { http_status: 401, http_basic_realm: "Wireless N Router" }],
    ["realm", { http_status: 401, http_basic_realm: "TP-LINK" }],
    ["origin", { http_final_origin: "http://nottplinkwifi.net" }],
    ["origin", { http_final_origin: "http://tplinkwifi.net.evil.example" }],
  ])("does not claim TP-Link from generic %s %j", (_k, evidence) => {
    expect(http(evidence).product).toBeUndefined();
  });
});

describe("Yealink fingerprints", () => {
  it.each([
    ["Yealink", undefined],
    ["Yealink SIP-T46S", "T46S"],
    ["Yealink T54W IP Phone", "T54W"],
    ["Yealink VP59 - Login", "VP59"],
    ["Yealink CP960", "CP960"],
  ])("recognizes title %s", (title, model) => {
    const service = http({ http_title: title });
    expect(service.product).toBe("Yealink");
    if (model) expect(service.evidence).toContain(`model hint ${model}`);
  });

  it("recognizes Server header, 401 realm and servlet path", () => {
    expect(http({ http_server: "Yealink" }).product).toBe("Yealink");
    expect(
      http({ http_status: 401, http_basic_realm: "Yealink SIP-T42U" }).product,
    ).toBe("Yealink");
    expect(
      identifyNetworkAppliance({
        text: '<a href="/servlet?m=mod_data&p=login&q=loginForm">',
      })?.product,
    ).toBe("Yealink");
  });

  it("identifies a Yealink SIP User-Agent with model and firmware", () => {
    const banner =
      "SIP/2.0 200 OK\r\nVia: SIP/2.0/UDP 192.0.2.1\r\nUser-Agent: Yealink SIP-T46S 66.85.0.5\r\nAllow: INVITE, ACK\r\n\r\n";
    expect(identifyYealinkSip(banner)).toEqual({
      model: "T46S",
      firmware: "66.85.0.5",
    });
    expect(fingerprintService(5060, banner)).toMatchObject({
      protocol: "raw",
      service: "sip",
      product: "Yealink",
      version: "66.85.0.5",
      detection: "identified",
    });
  });

  it.each([
    "SIP/2.0 200 OK\r\nUser-Agent: Asterisk PBX 20.1\r\n\r\n",
    "SIP/2.0 200 OK\r\nUser-Agent: Grandstream GXP2170 1.0.11.8\r\n\r\n",
    "HTTP/1.1 200 OK\r\nUser-Agent: Yealink SIP-T46S 1.0\r\n\r\n",
    "User-Agent: Yealink SIP-T46S 66.85.0.5",
  ])("does not claim Yealink SIP from %j", (banner) => {
    expect(identifyYealinkSip(banner)).toBeUndefined();
  });

  it.each([
    "Yealink alternatives",
    "Yealink phone review",
    "Not Yealink",
    "Grandstream GXP2170",
  ])("does not claim Yealink from title %s", (title) => {
    expect(http({ http_title: title }).product).toBeUndefined();
  });

  it("keeps TP-Link, Yealink and OPNsense mutually exclusive", () => {
    expect(
      identifyNetworkAppliance({ title: "Yealink SIP-T46S" })?.product,
    ).toBe("Yealink");
    expect(
      identifyNetworkAppliance({ title: "TP-LINK Wireless N Router WR841N" })
        ?.product,
    ).toBe("TP-Link");
  });
});
