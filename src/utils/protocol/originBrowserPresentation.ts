/** An overlay is still being removed. No focus or input has started.
 * Keep the original selection incarnation while waiting for its presentation. */
export class OriginBrowserPresentationPending extends Error {
  constructor(readonly assertCurrent: () => void) {
    super("The selected website presentation is not ready.");
    this.name = "OriginBrowserPresentationPending";
  }
}
