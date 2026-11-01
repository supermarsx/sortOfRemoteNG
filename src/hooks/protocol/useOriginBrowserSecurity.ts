"use client";

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserSnapshot } from "../../types/protocols/originBrowser";

export interface NativeSiteCertificate {
  subject: string;
  issuer: string;
  fingerprint: string;
  validFrom: string;
  validTo: string;
}
export interface NativeSiteObservation {
  systemCaValid: boolean;
  reviewed: boolean | null;
  observedAt: string;
  chain: NativeSiteCertificate[];
  tlsVersion?: string | null;
  cipherSuite?: string | null;
  source?: "upstream-handshake" | "browser-navigation";
}
export type SecurityTransport = (request: {
  identity: OriginBrowserSnapshot["identity"];
  sequence: number;
  origin: string;
  viewId?: string;
}) => Promise<unknown>;
const nativeTransport: SecurityTransport = (request) =>
  invoke("origin_browser_security_info", { request });

export function websiteSecurityOrigin(snapshot: OriginBrowserSnapshot | null) {
  try {
    if (!snapshot || snapshot.phase !== "attached") return null;
    // Never use the saved connection target or redacted display URL as evidence
    // of the current document. Older hosts explicitly remain unknown.
    const url = new URL(snapshot.currentUrl ?? "");
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function readNativeSiteObservation(
  value: unknown,
): NativeSiteObservation | null {
  const v = object(value);
  if (
    !v ||
    typeof v.systemCaValid !== "boolean" ||
    (typeof v.reviewed !== "boolean" && v.reviewed !== null) ||
    typeof v.observedAt !== "string" ||
    !Number.isFinite(Date.parse(v.observedAt)) ||
    !Array.isArray(v.chain) ||
    !v.chain.length ||
    v.chain.length > 32
  )
    return null;
  const chain: NativeSiteCertificate[] = [];
  const tlsText = (value: unknown) =>
    value == null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= 128 &&
      !/[\p{Cc}]/u.test(value));
  if (
    !tlsText(v.tlsVersion) ||
    !tlsText(v.cipherSuite) ||
    (v.source !== undefined &&
      v.source !== "upstream-handshake" &&
      v.source !== "browser-navigation")
  )
    return null;
  for (const value of v.chain) {
    const cert = object(value);
    if (
      !cert ||
      !["subject", "issuer", "fingerprint", "validFrom", "validTo"].every(
        (key) =>
          typeof cert[key] === "string" && (cert[key] as string).length <= 8192,
      ) ||
      !/^[a-f0-9]{64}$/i.test(cert.fingerprint as string) ||
      !Number.isFinite(Date.parse(cert.validFrom as string)) ||
      !Number.isFinite(Date.parse(cert.validTo as string))
    )
      return null;
    chain.push({
      subject: cert.subject as string,
      issuer: cert.issuer as string,
      fingerprint: cert.fingerprint as string,
      validFrom: cert.validFrom as string,
      validTo: cert.validTo as string,
    });
  }
  return {
    systemCaValid: v.systemCaValid,
    reviewed: v.reviewed,
    observedAt: v.observedAt,
    chain,
    ...(v.tlsVersion !== undefined && {
      tlsVersion: v.tlsVersion as string | null,
    }),
    ...(v.cipherSuite !== undefined && {
      cipherSuite: v.cipherSuite as string | null,
    }),
    ...(v.source !== undefined && {
      source: v.source as NativeSiteObservation["source"],
    }),
  };
}

export function useOriginBrowserSecurity(
  snapshot: OriginBrowserSnapshot | null,
  transport = nativeTransport,
  viewId: string | null = null,
) {
  const origin = websiteSecurityOrigin(snapshot);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const key = JSON.stringify([
    snapshot?.identity,
    snapshot?.sequence,
    origin,
    viewId,
    revision,
  ]);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    observation: NativeSiteObservation | null;
    unavailable: boolean;
  }>();
  useEffect(() => {
    if (!snapshot || !origin || !origin.startsWith("https://")) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;
    const request = {
      identity: snapshot.identity,
      sequence: snapshot.sequence,
      origin,
      ...(viewId && { viewId }),
    };
    setState({ key, loading: true, observation: null, unavailable: false });
    const read = () => {
      reads++;
      void transport(request)
        .then((value) => {
          if (!active) return;
          const result = object(value);
          const identity = object(result?.identity);
          const sameIdentity =
            identity &&
            Object.entries(request.identity).every(
              ([key, value]) => identity[key] === value,
            );
          if (
            !result ||
            !sameIdentity ||
            result.sequence !== request.sequence ||
            result.origin !== origin ||
            (result.viewId ?? null) !== viewId
          )
            return setState({
              key,
              loading: false,
              observation: null,
              unavailable: true,
            });
          const observation = readNativeSiteObservation(result.observation);
          // Parsing and the TLS completion callback may still be publishing the
          // current handshake. Retry only the same fenced, read-only receipt.
          if (result.availability === "pending" && reads < 8) {
            setState({ key, loading: true, observation, unavailable: false });
            timer = setTimeout(read, Math.min(1000, 200 * reads));
            return;
          }
          setState({
            key,
            loading: false,
            observation,
            unavailable: result.observation !== null && !observation,
          });
        })
        .catch(() => {
          if (active)
            setState({
              key,
              loading: false,
              observation: null,
              unavailable: true,
            });
        });
    };
    read();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key, origin, snapshot, transport, viewId]);
  return {
    origin,
    loading:
      origin?.startsWith("https://") && state?.key !== key
        ? true
        : state?.key === key && state.loading,
    observation: state?.key === key ? state.observation : null,
    unavailable: state?.key === key && state.unavailable,
    refresh,
  };
}
