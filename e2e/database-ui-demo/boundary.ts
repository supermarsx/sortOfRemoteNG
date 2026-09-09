export const demo = {
  refused: [] as string[],
  completed: 0,
  ready: false,
  advance: () => {},
};
declare global {
  interface Window {
    __DATABASE_UI_DEMO__: typeof demo;
  }
}
window.__DATABASE_UI_DEMO__ = demo;
export function refuse(operation: string): never {
  demo.refused.push(operation);
  throw new Error(`Isolated database demo refused ${operation}`);
}
for (const method of ["getItem", "setItem", "removeItem", "clear"] as const)
  Object.defineProperty(Storage.prototype, method, {
    configurable: true,
    value: () => refuse(`browser storage ${method}`),
  });
Object.defineProperty(window, "indexedDB", {
  configurable: true,
  get: () => refuse("IndexedDB"),
});
window.addEventListener("error", (event) => {
  demo.refused.push(event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  demo.refused.push(String(event.reason));
});
