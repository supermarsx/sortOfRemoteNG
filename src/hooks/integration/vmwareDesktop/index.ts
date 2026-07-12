// VMware Workstation integration hooks barrel (t42, vmware-desktop).
// The lead owns the connection slice; category execs append their own
// `export * from "./useVmwDesktop<Category>"` lines here is NOT how it works —
// category execs import their hooks directly from their own files to keep this
// barrel disjoint. This barrel re-exports the lead-owned connection slice only.
export * from "./useVmwDesktopConnection";
