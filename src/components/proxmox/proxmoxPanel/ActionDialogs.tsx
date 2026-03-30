import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../../ui/overlays/Modal";
import { Checkbox, NumberInput, TextInput } from "../../ui/forms";
import type {
  LxcCloneParams,
  LxcCreateParams,
  LxcMigrateParams,
  QemuCloneParams,
  QemuCreateParams,
  QemuMigrateParams,
} from "../../../types/hardware/proxmox";
import type { SubProps } from "./types";

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1.5 text-sm text-[var(--color-text)]">
    <span className="font-medium">{label}</span>
    {children}
    {hint && <span className="text-xs text-[var(--color-textSecondary)]">{hint}</span>}
  </label>
);

const ToggleField: React.FC<{ label: string; checked: boolean; onChange: (checked: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
    <Checkbox checked={checked} onChange={onChange} variant="form" />
    <span>{label}</span>
  </label>
);

const FooterButtons: React.FC<{ onCancel: () => void; submitLabel: string; submitting: boolean }> = ({
  onCancel,
  submitLabel,
  submitting,
}) => (
  <ModalFooter className="flex justify-end gap-3 border-t border-[var(--color-border)] p-4">
    <button
      type="button"
      onClick={onCancel}
      className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-background)]"
    >
      Cancel
    </button>
    <button
      type="submit"
      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={submitting}
    >
      {submitting ? "Saving..." : submitLabel}
    </button>
  </ModalFooter>
);

const nextAvailableVmId = (mgr: SubProps["mgr"]) => {
  const ids = [
    ...mgr.qemuVms.map((vm) => vm.vmid),
    ...mgr.lxcContainers.map((container) => container.vmid),
  ];

  return (ids.length ? Math.max(...ids) : 99) + 1;
};

const ActionDialogs: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const storageOptions = useMemo(
    () => Array.from(new Set(mgr.storage.map((item) => item.storage))).filter(Boolean),
    [mgr.storage],
  );
  const availableNodes = useMemo(() => mgr.nodes.map((node) => node.node), [mgr.nodes]);
  const suggestedVmId = useMemo(() => nextAvailableVmId(mgr), [mgr.qemuVms, mgr.lxcContainers]);
  const targetNodes = useMemo(
    () => availableNodes.filter((node) => node !== mgr.dialogNode),
    [availableNodes, mgr.dialogNode],
  );

  const [qemuForm, setQemuForm] = useState<QemuCreateParams>({
    vmid: 100,
    name: "",
    memory: 4096,
    cores: 2,
    storage: "",
    start: true,
  });
  const [lxcForm, setLxcForm] = useState<LxcCreateParams>({
    vmid: 101,
    ostemplate: "",
    hostname: "",
    memory: 2048,
    cores: 2,
    rootfs: "local-lvm:8",
    storage: "",
    start: true,
    onboot: true,
  });
  const [cloneForm, setCloneForm] = useState<QemuCloneParams & { hostname?: string }>({
    newid: 102,
    name: "",
    hostname: "",
    target: "",
    storage: "",
    full: true,
  });
  const [migrateForm, setMigrateForm] = useState<{
    target: string;
    online: boolean;
    force: boolean;
    withLocalDisks: boolean;
    restart: boolean;
    targetstorage: string;
  }>({
    target: "",
    online: true,
    force: false,
    withLocalDisks: false,
    restart: false,
    targetstorage: "",
  });

  useEffect(() => {
    if (!mgr.showCreateVm) return;
    setDialogError(null);
    setQemuForm({
      vmid: suggestedVmId,
      name: "",
      memory: 4096,
      cores: 2,
      storage: storageOptions[0] ?? "",
      start: true,
      onboot: true,
    });
  }, [mgr.showCreateVm, storageOptions, suggestedVmId]);

  useEffect(() => {
    if (!mgr.showCreateLxcDialog) return;
    setDialogError(null);
    setLxcForm({
      vmid: suggestedVmId,
      ostemplate: "",
      hostname: "",
      memory: 2048,
      cores: 2,
      rootfs: `${storageOptions[0] ?? "local-lvm"}:8`,
      storage: storageOptions[0] ?? "",
      start: true,
      onboot: true,
    });
  }, [mgr.showCreateLxcDialog, storageOptions, suggestedVmId]);

  useEffect(() => {
    if (!mgr.showCloneDialog) return;
    setDialogError(null);
    setCloneForm({
      newid: suggestedVmId,
      name: "",
      hostname: "",
      target: targetNodes[0] ?? mgr.dialogNode ?? "",
      storage: storageOptions[0] ?? "",
      full: true,
    });
  }, [mgr.dialogNode, mgr.showCloneDialog, storageOptions, suggestedVmId, targetNodes]);

  useEffect(() => {
    if (!mgr.showMigrateDialog) return;
    setDialogError(null);
    setMigrateForm({
      target: targetNodes[0] ?? "",
      online: true,
      force: false,
      withLocalDisks: false,
      restart: false,
      targetstorage: storageOptions[0] ?? "",
    });
  }, [mgr.showMigrateDialog, storageOptions, targetNodes]);

  const closeDialog = () => {
    setDialogError(null);
    setSubmitting(false);
    mgr.closeActionDialogs();
  };

  const submitCreateVm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mgr.dialogNode) {
      setDialogError(t("proxmox.dialogs.nodeRequired", "Select a node before creating a VM."));
      return;
    }

    setSubmitting(true);
    setDialogError(null);

    try {
      await mgr.createQemuVm(mgr.dialogNode, qemuForm);
      closeDialog();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCreateLxc = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mgr.dialogNode) {
      setDialogError(t("proxmox.dialogs.nodeRequired", "Select a node before creating a container."));
      return;
    }

    setSubmitting(true);
    setDialogError(null);

    try {
      await mgr.createLxcContainer(mgr.dialogNode, lxcForm);
      closeDialog();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const submitClone = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mgr.dialogNode || !mgr.dialogVmId || !mgr.dialogVmType) {
      setDialogError(t("proxmox.dialogs.selectionRequired", "Select a VM or container before cloning."));
      return;
    }

    setSubmitting(true);
    setDialogError(null);

    try {
      if (mgr.dialogVmType === "qemu") {
        const params: QemuCloneParams = {
          newid: cloneForm.newid,
          name: cloneForm.name || undefined,
          target: cloneForm.target || undefined,
          storage: cloneForm.storage || undefined,
          full: cloneForm.full,
        };
        await mgr.cloneQemuVm(mgr.dialogNode, mgr.dialogVmId, params);
      } else {
        const params: LxcCloneParams = {
          newid: cloneForm.newid,
          hostname: cloneForm.hostname || undefined,
          target: cloneForm.target || undefined,
          storage: cloneForm.storage || undefined,
          full: cloneForm.full,
        };
        await mgr.cloneLxcContainer(mgr.dialogNode, mgr.dialogVmId, params);
      }

      closeDialog();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const submitMigrate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mgr.dialogNode || !mgr.dialogVmId || !mgr.dialogVmType || !migrateForm.target) {
      setDialogError(t("proxmox.dialogs.targetRequired", "Choose a target node before starting migration."));
      return;
    }

    setSubmitting(true);
    setDialogError(null);

    try {
      if (mgr.dialogVmType === "qemu") {
        const params: QemuMigrateParams = {
          target: migrateForm.target,
          online: migrateForm.online,
          force: migrateForm.force,
          withLocalDisks: migrateForm.withLocalDisks,
          targetstorage: migrateForm.targetstorage || undefined,
        };
        await mgr.migrateQemuVm(mgr.dialogNode, mgr.dialogVmId, params);
      } else {
        const params: LxcMigrateParams = {
          target: migrateForm.target,
          online: migrateForm.online,
          restart: migrateForm.restart,
          force: migrateForm.force,
          targetstorage: migrateForm.targetstorage || undefined,
        };
        await mgr.migrateLxcContainer(mgr.dialogNode, mgr.dialogVmId, params);
      }

      closeDialog();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal isOpen={mgr.showCreateVm} onClose={closeDialog} panelClassName="max-w-2xl mx-4">
        <form onSubmit={submitCreateVm}>
          <ModalHeader title={t("proxmox.dialogs.createVm", "Create VM")} onClose={closeDialog} />
          <ModalBody className="space-y-4 p-5">
            {dialogError && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{dialogError}</div>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("proxmox.dialogs.node", "Node")}>
                <input value={mgr.dialogNode ?? ""} readOnly className="sor-form-input-sm bg-[var(--color-background)]" />
              </Field>
              <Field label={t("proxmox.dialogs.vmid", "VM ID")}>
                <NumberInput value={qemuForm.vmid} onChange={(value) => setQemuForm((prev) => ({ ...prev, vmid: value }))} variant="form-sm" min={100} />
              </Field>
              <Field label={t("proxmox.dialogs.name", "Name")}>
                <TextInput value={qemuForm.name ?? ""} onChange={(value) => setQemuForm((prev) => ({ ...prev, name: value }))} variant="form-sm" placeholder="web-01" />
              </Field>
              <Field label={t("proxmox.dialogs.storage", "Storage")} hint={t("proxmox.dialogs.storageHint", "Optional pool hint passed through to the backend.")}>
                <TextInput value={qemuForm.storage ?? ""} onChange={(value) => setQemuForm((prev) => ({ ...prev, storage: value }))} variant="form-sm" list="proxmox-storage-options" placeholder="local-lvm" />
              </Field>
              <Field label={t("proxmox.dialogs.memory", "Memory (MB)")}>
                <NumberInput value={qemuForm.memory ?? 4096} onChange={(value) => setQemuForm((prev) => ({ ...prev, memory: value }))} variant="form-sm" min={256} step={256} />
              </Field>
              <Field label={t("proxmox.dialogs.cores", "CPU Cores")}>
                <NumberInput value={qemuForm.cores ?? 2} onChange={(value) => setQemuForm((prev) => ({ ...prev, cores: value }))} variant="form-sm" min={1} max={64} />
              </Field>
            </div>
            <ToggleField label={t("proxmox.dialogs.startAfterCreate", "Start VM after creation")} checked={Boolean(qemuForm.start)} onChange={(checked) => setQemuForm((prev) => ({ ...prev, start: checked }))} />
          </ModalBody>
          <FooterButtons onCancel={closeDialog} submitLabel={t("proxmox.dialogs.createVmAction", "Create VM")} submitting={submitting} />
        </form>
      </Modal>

      <Modal isOpen={mgr.showCreateLxcDialog} onClose={closeDialog} panelClassName="max-w-2xl mx-4">
        <form onSubmit={submitCreateLxc}>
          <ModalHeader title={t("proxmox.dialogs.createContainer", "Create Container")} onClose={closeDialog} />
          <ModalBody className="space-y-4 p-5">
            {dialogError && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{dialogError}</div>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("proxmox.dialogs.node", "Node")}>
                <input value={mgr.dialogNode ?? ""} readOnly className="sor-form-input-sm bg-[var(--color-background)]" />
              </Field>
              <Field label={t("proxmox.dialogs.vmid", "Container ID")}>
                <NumberInput value={lxcForm.vmid} onChange={(value) => setLxcForm((prev) => ({ ...prev, vmid: value }))} variant="form-sm" min={100} />
              </Field>
              <Field label={t("proxmox.dialogs.hostname", "Hostname")}>
                <TextInput value={lxcForm.hostname ?? ""} onChange={(value) => setLxcForm((prev) => ({ ...prev, hostname: value }))} variant="form-sm" placeholder="app-01" />
              </Field>
              <Field label={t("proxmox.dialogs.template", "OS Template")} hint={t("proxmox.dialogs.templateHint", "Example: local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst")}>
                <TextInput value={lxcForm.ostemplate} onChange={(value) => setLxcForm((prev) => ({ ...prev, ostemplate: value }))} variant="form-sm" placeholder="local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst" />
              </Field>
              <Field label={t("proxmox.dialogs.rootfs", "Root FS")}>
                <TextInput value={lxcForm.rootfs ?? ""} onChange={(value) => setLxcForm((prev) => ({ ...prev, rootfs: value }))} variant="form-sm" placeholder="local-lvm:8" />
              </Field>
              <Field label={t("proxmox.dialogs.storage", "Storage")}>
                <TextInput value={lxcForm.storage ?? ""} onChange={(value) => setLxcForm((prev) => ({ ...prev, storage: value }))} variant="form-sm" list="proxmox-storage-options" placeholder="local-lvm" />
              </Field>
              <Field label={t("proxmox.dialogs.memory", "Memory (MB)")}>
                <NumberInput value={lxcForm.memory ?? 2048} onChange={(value) => setLxcForm((prev) => ({ ...prev, memory: value }))} variant="form-sm" min={128} step={128} />
              </Field>
              <Field label={t("proxmox.dialogs.cores", "CPU Cores")}>
                <NumberInput value={lxcForm.cores ?? 2} onChange={(value) => setLxcForm((prev) => ({ ...prev, cores: value }))} variant="form-sm" min={1} max={64} />
              </Field>
              <Field label={t("proxmox.dialogs.password", "Initial Password")}>
                <input
                  type="password"
                  value={lxcForm.password ?? ""}
                  onChange={(event) => setLxcForm((prev) => ({ ...prev, password: event.target.value }))}
                  className="sor-form-input-sm"
                  placeholder="Optional"
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleField label={t("proxmox.dialogs.startAfterCreate", "Start container after creation")} checked={Boolean(lxcForm.start)} onChange={(checked) => setLxcForm((prev) => ({ ...prev, start: checked }))} />
              <ToggleField label={t("proxmox.dialogs.onBoot", "Start on boot")} checked={Boolean(lxcForm.onboot)} onChange={(checked) => setLxcForm((prev) => ({ ...prev, onboot: checked }))} />
            </div>
          </ModalBody>
          <FooterButtons onCancel={closeDialog} submitLabel={t("proxmox.dialogs.createContainerAction", "Create Container")} submitting={submitting} />
        </form>
      </Modal>

      <Modal isOpen={mgr.showCloneDialog} onClose={closeDialog} panelClassName="max-w-xl mx-4">
        <form onSubmit={submitClone}>
          <ModalHeader title={t("proxmox.dialogs.clone", "Clone Guest")} onClose={closeDialog} />
          <ModalBody className="space-y-4 p-5">
            {dialogError && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{dialogError}</div>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("proxmox.dialogs.sourceNode", "Source Node")}>
                <input value={mgr.dialogNode ?? ""} readOnly className="sor-form-input-sm bg-[var(--color-background)]" />
              </Field>
              <Field label={t("proxmox.dialogs.sourceId", "Source ID")}>
                <input value={mgr.dialogVmId ?? ""} readOnly className="sor-form-input-sm bg-[var(--color-background)]" />
              </Field>
              <Field label={t("proxmox.dialogs.newId", "New ID")}>
                <NumberInput value={cloneForm.newid} onChange={(value) => setCloneForm((prev) => ({ ...prev, newid: value }))} variant="form-sm" min={100} />
              </Field>
              <Field label={mgr.dialogVmType === "qemu" ? t("proxmox.dialogs.newName", "New VM Name") : t("proxmox.dialogs.newHostname", "New Hostname")}>
                <TextInput
                  value={mgr.dialogVmType === "qemu" ? cloneForm.name ?? "" : cloneForm.hostname ?? ""}
                  onChange={(value) => setCloneForm((prev) => mgr.dialogVmType === "qemu" ? ({ ...prev, name: value }) : ({ ...prev, hostname: value }))}
                  variant="form-sm"
                  placeholder={mgr.dialogVmType === "qemu" ? "clone-vm" : "clone-ct"}
                />
              </Field>
              <Field label={t("proxmox.dialogs.targetNode", "Target Node")}>
                <select value={cloneForm.target ?? ""} onChange={(event) => setCloneForm((prev) => ({ ...prev, target: event.target.value }))} className="sor-form-input-sm">
                  <option value="">{t("proxmox.dialogs.currentNode", "Keep on current node")}</option>
                  {targetNodes.map((node) => <option key={node} value={node}>{node}</option>)}
                </select>
              </Field>
              <Field label={t("proxmox.dialogs.storage", "Target Storage")}>
                <TextInput value={cloneForm.storage ?? ""} onChange={(value) => setCloneForm((prev) => ({ ...prev, storage: value }))} variant="form-sm" list="proxmox-storage-options" placeholder="Optional" />
              </Field>
            </div>
            <ToggleField label={t("proxmox.dialogs.fullClone", "Create a full clone")} checked={Boolean(cloneForm.full)} onChange={(checked) => setCloneForm((prev) => ({ ...prev, full: checked }))} />
          </ModalBody>
          <FooterButtons onCancel={closeDialog} submitLabel={t("proxmox.dialogs.cloneAction", "Clone")} submitting={submitting} />
        </form>
      </Modal>

      <Modal isOpen={mgr.showMigrateDialog} onClose={closeDialog} panelClassName="max-w-xl mx-4">
        <form onSubmit={submitMigrate}>
          <ModalHeader title={t("proxmox.dialogs.migrate", "Migrate Guest")} onClose={closeDialog} />
          <ModalBody className="space-y-4 p-5">
            {dialogError && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{dialogError}</div>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("proxmox.dialogs.sourceNode", "Source Node")}>
                <input value={mgr.dialogNode ?? ""} readOnly className="sor-form-input-sm bg-[var(--color-background)]" />
              </Field>
              <Field label={t("proxmox.dialogs.sourceId", "Guest ID")}>
                <input value={mgr.dialogVmId ?? ""} readOnly className="sor-form-input-sm bg-[var(--color-background)]" />
              </Field>
              <Field label={t("proxmox.dialogs.targetNode", "Target Node")}>
                <select value={migrateForm.target} onChange={(event) => setMigrateForm((prev) => ({ ...prev, target: event.target.value }))} className="sor-form-input-sm">
                  <option value="">{t("proxmox.dialogs.selectTarget", "Select target node")}</option>
                  {targetNodes.map((node) => <option key={node} value={node}>{node}</option>)}
                </select>
              </Field>
              <Field label={t("proxmox.dialogs.targetStorage", "Target Storage")}>
                <TextInput value={migrateForm.targetstorage} onChange={(value) => setMigrateForm((prev) => ({ ...prev, targetstorage: value }))} variant="form-sm" list="proxmox-storage-options" placeholder="Optional" />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleField label={t("proxmox.dialogs.online", "Attempt online migration")} checked={migrateForm.online} onChange={(checked) => setMigrateForm((prev) => ({ ...prev, online: checked }))} />
              <ToggleField label={t("proxmox.dialogs.force", "Force migration if needed")} checked={migrateForm.force} onChange={(checked) => setMigrateForm((prev) => ({ ...prev, force: checked }))} />
              {mgr.dialogVmType === "qemu" ? (
                <ToggleField label={t("proxmox.dialogs.withLocalDisks", "Include local disks")} checked={migrateForm.withLocalDisks} onChange={(checked) => setMigrateForm((prev) => ({ ...prev, withLocalDisks: checked }))} />
              ) : (
                <ToggleField label={t("proxmox.dialogs.restart", "Restart after migration if required")} checked={migrateForm.restart} onChange={(checked) => setMigrateForm((prev) => ({ ...prev, restart: checked }))} />
              )}
            </div>
          </ModalBody>
          <FooterButtons onCancel={closeDialog} submitLabel={t("proxmox.dialogs.migrateAction", "Start Migration")} submitting={submitting} />
        </form>
      </Modal>

      <datalist id="proxmox-storage-options">
        {storageOptions.map((storage) => (
          <option key={storage} value={storage} />
        ))}
      </datalist>
    </>
  );
};

export default ActionDialogs;