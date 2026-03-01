import { Mgr } from "./types";

const AuthTypeSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="md:col-span-2">
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
      Authentication Type
    </label>
    <Select value={mgr.formData.authType ?? "basic"} onChange={(v: string) => mgr.setFormData({ ...mgr.formData, authType: v as any })} options={[{ value: "basic", label: "Basic Authentication" }, { value: "header", label: "Custom Headers" }]} variant="form" />
  </div>
);


export default AuthTypeSection;
