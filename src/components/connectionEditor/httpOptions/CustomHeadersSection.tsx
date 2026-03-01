import { Mgr } from "./types";

const CustomHeadersSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.formData.authType !== "header") return null;
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        Custom HTTP Headers
      </label>
      <div className="space-y-2">
        {Object.entries(mgr.formData.httpHeaders || {}).map(([key, value]) => (
          <div key={key} className="flex items-center space-x-2">
            <input
              type="text"
              value={key}
              readOnly
              className="flex-1 px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
            />
            <input
              type="text"
              value={value}
              onChange={(e) =>
                mgr.setFormData({
                  ...mgr.formData,
                  httpHeaders: {
                    ...(mgr.formData.httpHeaders || {}),
                    [key]: e.target.value,
                  },
                })
              }
              className="sor-form-input flex-1"
            />
            <button
              type="button"
              onClick={() => mgr.removeHttpHeader(key)}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-[var(--color-text)] rounded-md transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => mgr.setShowAddHeader(true)}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
        >
          Add Header
        </button>
      </div>
    </div>
  );
};

export default CustomHeadersSection;
