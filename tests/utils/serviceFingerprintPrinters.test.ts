import { describe, expect, it } from "vitest";
import { fingerprintService } from "../../src/utils/discovery/serviceFingerprint";

const http = (server?: string, title?: string) =>
  fingerprintService(80, undefined, undefined, {
    http_status: 200,
    http_server: server,
    http_title: title,
  });

// Hand-written synthetic strings; no vendor firmware or captures were used.
describe("printer fingerprinting", () => {
  it.each([
    ["HP Color LaserJet Pro M454dw", "HP printer"],
    ["hp LaserJet 4250", "HP printer"],
    ["HP LaserJet MFP M430f", "HP printer"],
    ["HP OfficeJet Pro 9015e series", "HP printer"],
    ["HP PageWide Pro 477dw MFP", "HP printer"],
    ["KYOCERA ECOSYS M2540dn", "Kyocera printer"],
    ["TASKalfa 3253ci", "Kyocera printer"],
    ["Command Center RX", "Kyocera printer"],
    ["KYOCERA Command Center RX ECOSYS M5526cdw", "Kyocera printer"],
    ["Brother HL-L2350DW series", "Brother printer"],
    ["Brother MFC-L8900CDW", "Brother printer"],
    ["Brother DCP-T520W", "Brother printer"],
    ["Brother Web Based Management", "Brother printer"],
  ])("recognizes printer title %s", (title, product) => {
    const s = http("nginx/1.24", title);
    expect(s.detection).toBe("identified");
    expect(s.product).toBe(product);
    expect(s.protocol).toBe("http");
  });

  it.each([
    ["HP HTTP Server", "HP printer"],
    ["HP-ChaiServer/3.0", "HP printer"],
    ["KM-MFP-http/V0.0.1", "Kyocera printer"],
    ["debut/1.20", "Brother printer"],
    ["debut", "Brother printer"],
  ])("recognizes printer Server header %s", (server, product) => {
    const s = http(server, "Home");
    expect(s.product).toBe(product);
    expect(s.evidence).toContain(`Server: ${server}`);
    expect(s.version).toBeUndefined();
  });

  it("reads the Server header from a raw HTTP banner", () => {
    const s = fingerprintService(
      80,
      "HTTP/1.1 200 OK\r\nServer: debut/1.20\r\n\r\n",
    );
    expect(s.product).toBe("Brother printer");
  });

  it.each([
    ["HP-iLO-Server/1.30", "Login", "HPE iLO"],
    ["HPE-iLO-Server/2.0", "HPE iLO 5", "HPE iLO"],
    ["httpd", "HP iLO Sign In", "HPE iLO"],
  ])("keeps HP servers (%s / %s) out of the printer family", (s, t, p) => {
    expect(http(s, t).product).toBe(p);
  });

  it.each([
    ["httpd", "HP ProLiant DL380 Gen10"],
    ["httpd", "HP Support Documentation"],
    ["httpd", "HP LaserJetfoo"],
    ["httpd", "HP Smart Tank is great, buy now"],
    ["httpd", "Brother"],
    ["httpd", "Brother in law blog"],
    ["httpd", "My Brother HL-guide: review everything"],
    ["httpd", "Kyocera"],
    ["httpd", "KYOCERA Corporation careers"],
    ["httpd", "ECOSYS"],
    ["debut-lookalike/1.0", "Home"],
    ["not-debut/1.20", "Home"],
    ["HP HTTP Servers", "Home"],
    ["XKM-MFP-http", "Home"],
    ["Embedded HTTP Server", "Printer"],
  ])("does not infer a printer from %s / %s", (server, title) => {
    const s = http(server, title);
    expect(s.product ?? "").not.toMatch(/printer/);
  });

  it("does not identify a printer from port 9100, 631 or 80 alone", () => {
    for (const port of [9100, 631, 80]) {
      expect(fingerprintService(port).product).toBeUndefined();
    }
  });
});
