import type { DiagnosticsMgr } from "../../../hooks/connection/useConnectionDiagnostics";
import type { Connection } from "../../../types/connection/connection";

type DiagnosticsPrintManager = Pick<
  DiagnosticsMgr,
  "results" | "protocolReport" | "minPing" | "avgPingTime" | "maxPing"
>;

function printableText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Replaces a blank print document using DOM APIs only. Diagnostic values are
 * always text nodes, so they cannot introduce elements, attributes, or scripts.
 */
export function renderDiagnosticsPrintDocument(
  doc: Document,
  connection: Connection,
  mgr: DiagnosticsPrintManager,
  generatedAt = new Date(),
): void {
  const title = `Diagnostics — ${connection.name} (${connection.hostname})`;
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const style = doc.createElement("style");
  style.textContent = [
    "body{font-family:system-ui,sans-serif;font-size:12px;max-width:900px;margin:0 auto;padding:20px}",
    "h1{font-size:18px;margin-bottom:4px}",
    "h2{font-size:14px;margin-top:16px;border-bottom:1px solid #ccc;padding-bottom:4px}",
    "table{border-collapse:collapse;width:100%;font-size:11px}",
    "th,td{border:1px solid #999;padding:4px}",
    "th{background:#f0f0f0;text-align:left}",
    "p{margin:4px 0}",
    ".generated-at{color:#666}",
  ].join("");

  doc.documentElement.lang = "en";
  doc.head.replaceChildren(charset, csp, style);
  doc.body.replaceChildren();
  doc.title = title;

  const appendTextElement = (
    parent: HTMLElement,
    tagName: keyof HTMLElementTagNameMap,
    text: string,
    className?: string,
  ): HTMLElement => {
    const element = doc.createElement(tagName);
    element.textContent = text;
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
  };

  const appendField = (
    parent: HTMLElement,
    label: string,
    value: unknown,
  ): void => {
    const paragraph = doc.createElement("p");
    const labelElement = doc.createElement("b");
    labelElement.textContent = `${label}:`;
    paragraph.append(
      labelElement,
      doc.createTextNode(` ${printableText(value)}`),
    );
    parent.appendChild(paragraph);
  };

  appendTextElement(doc.body, "h1", title);
  appendTextElement(
    doc.body,
    "p",
    generatedAt.toLocaleString(),
    "generated-at",
  );

  let hasSections = false;
  const {
    dnsResult,
    tcpTiming: tcpResult,
    pings,
    tlsCheck: tlsResult,
  } = mgr.results;

  if (pings.length > 0 || tcpResult || dnsResult) {
    hasSections = true;
    const section = doc.createElement("section");
    appendTextElement(section, "h2", "Network");
    if (dnsResult) appendField(section, "DNS", dnsResult);
    if (tcpResult) appendField(section, "TCP", tcpResult);
    if (mgr.minPing != null && mgr.avgPingTime != null && mgr.maxPing != null) {
      const loss =
        pings.length > 0
          ? (
              (pings.filter((ping) => !ping.success).length / pings.length) *
              100
            ).toFixed(1)
          : "0";
      appendField(
        section,
        "Ping",
        `min=${mgr.minPing}ms avg=${mgr.avgPingTime}ms max=${mgr.maxPing}ms loss=${loss}%`,
      );
    }
    doc.body.appendChild(section);
  }

  if (mgr.protocolReport) {
    hasSections = true;
    const section = doc.createElement("section");
    appendTextElement(section, "h2", "Protocol Diagnostics");
    appendField(section, "Summary", mgr.protocolReport.summary);
    if (mgr.protocolReport.rootCauseHint) {
      appendField(section, "Root Cause", mgr.protocolReport.rootCauseHint);
    }

    const table = doc.createElement("table");
    const head = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    for (const label of ["Step", "Status", "Duration", "Message"]) {
      appendTextElement(headRow, "th", label);
    }
    head.appendChild(headRow);
    table.appendChild(head);

    const body = doc.createElement("tbody");
    for (const step of mgr.protocolReport.steps) {
      const row = doc.createElement("tr");
      appendTextElement(row, "td", step.name);
      appendTextElement(row, "td", step.status);
      appendTextElement(row, "td", `${step.durationMs}ms`);
      appendTextElement(row, "td", step.message);
      body.appendChild(row);
    }
    table.appendChild(body);
    section.appendChild(table);
    doc.body.appendChild(section);
  }

  if (tlsResult) {
    hasSections = true;
    const section = doc.createElement("section");
    appendTextElement(section, "h2", "Certificate / Security");
    appendField(section, "Subject", tlsResult.certificate_subject ?? "N/A");
    appendField(section, "Issuer", tlsResult.certificate_issuer ?? "N/A");
    appendField(section, "Expires", tlsResult.certificate_expiry ?? "N/A");
    appendField(section, "TLS Version", tlsResult.tls_version ?? "N/A");
    doc.body.appendChild(section);
  }

  if (!hasSections) {
    appendTextElement(
      doc.body,
      "p",
      "No diagnostic results yet. Run diagnostics first.",
    );
  }
}
