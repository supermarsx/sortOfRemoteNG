// sorng-keepass — integration hooks barrel.
//
// Category execs append their slice here:
//   export * from "./useKeepassDatabase"; // t42-keepass-c1
//   export * from "./useKeepassTools";    // t42-keepass-c2
// Each slice exports a thin `keepass<Cat>Api` (one `invoke` wrapper per command)
// plus a `useKeepass<Cat>()` React hook, mirroring `useFileTransfer` /
// `useSFTPClient`. The shell's open/create flow is inline in `KeepassPanel.tsx`
// and does NOT depend on this barrel (keeps the lead shell compilable standalone).

// Appended by the per-crate integrator (t42-keepass-L) once each slice landed.
export * from "./useKeepassDatabase"; // t42-keepass-c1
export * from "./useKeepassTools"; // t42-keepass-c2
