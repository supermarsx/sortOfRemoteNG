// DrayTek integration hooks — barrel (t68 D3).
//
// The connection lifecycle (draytek_connect/disconnect/list_connections/ping)
// is driven by the panel shell (`DrayTekPanel.tsx`) through `draytekApi`; the
// sub-tabs use `useDraytek()` for the shared request lifecycle.
export * from "./useDraytek";
