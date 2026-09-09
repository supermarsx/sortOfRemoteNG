/** Fatal even when a production hook catches a rejected boundary call. */
export const refusedCalls: string[] = [];
export function refuse(operation: string): never {
  refusedCalls.push(operation);
  document.documentElement.dataset.docsFatal = operation;
  throw new Error(`Documentation fixture refused: ${operation}`);
}
window.addEventListener("error", (event) => {
  refusedCalls.push(`Browser error: ${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  refusedCalls.push(`Unhandled rejection: ${String(event.reason)}`);
});
document.addEventListener("securitypolicyviolation", (event) => {
  refusedCalls.push(`Blocked resource: ${event.blockedURI}`);
});
