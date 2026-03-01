import { Mgr } from "./types";

const HeaderModal: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.showAddHeader) return null;
  return (
    <Modal
      isOpen={mgr.showAddHeader}
      onClose={() => mgr.setShowAddHeader(false)}
      panelClassName="max-w-md mx-4"
      dataTestId="http-options-header-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader
          onClose={() => mgr.setShowAddHeader(false)}
          className="relative h-12 border-b border-[var(--color-border)]"
          titleClassName="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]"
          title="Add HTTP Header"
        />
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Header Name
            </label>
            <input
              ref={mgr.headerNameRef}
              type="text"
              value={mgr.headerName}
              onChange={(e) => mgr.setHeaderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleAddHeader();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. Authorization"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Header Value
            </label>
            <input
              type="text"
              value={mgr.headerValue}
              onChange={(e) => mgr.setHeaderValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleAddHeader();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. Bearer token123"
            />
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => mgr.setShowAddHeader(false)}
              className="px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={mgr.handleAddHeader}
              className="px-4 py-2 text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default HeaderModal;
