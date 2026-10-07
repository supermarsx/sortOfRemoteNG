/** Public projection only. Native-private cookies and keys never inhabit this type. */
export interface BrowserSessionDescriptor {
  connectionId: string;
  /** Native logical revision; independent of transfer encryption randomness. */
  revision: string;
}

export interface BrowserSessionsDescriptor {
  version: 1;
  records: BrowserSessionDescriptor[];
}

/** Password-sealed native capsule. Never parse or decrypt this in the renderer. */
export interface BrowserSessionsTransfer {
  version: 1;
  ciphertext: string;
}
