import { createRoot } from "react-dom/client";
import { useState } from "react";
import { useSettingHighlight } from "../../src/components/SettingsDialog/useSettingHighlight";
import { Modal } from "../../src/components/ui/overlays/Modal";
import { Select } from "../../src/components/ui/forms/Select";

export function Demo() {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState("0");
  useSettingHighlight(highlight);
  return (
    <>
      <style>{`
      html,body,#root { margin:0; height:100%; overflow:hidden; font:16px system-ui; background:#111827; color:#e5e7eb; }
      button,input { font:inherit; padding:8px; }
      #shell { position:relative; height:320px; width:600px; margin:24px; overflow:hidden; outline:2px solid #64748b; }
      #toolbar { height:48px; background:#334155; display:flex; align-items:center; padding:0 12px; }
      #settings-lane { margin-top:120px; height:120px; overflow:auto; background:#1e293b; padding:8px; }
      #target { height:60px; background:#374151; }
      .sor-modal-backdrop { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:#0009; }
      .sor-modal-panel { background:#334155; padding:16px; width:400px; max-height:70vh; overflow:auto; }
      .sor-select-dropdown { background:#334155; }
      .sor-select-dropdown-scroll { max-height:160px; overflow:auto; }
      .sor-select-option { height:32px; padding:4px; }
      .sor-select-option-highlighted { background:#2563eb; }
    `}</style>
      <p style={{ margin: 24 }}>
        Synthetic overflow stress fixture — real settings highlight, Select and
        Modal components.
      </p>
      <button id="highlight" onClick={() => setHighlight("viewport-target")}>
        Reveal setting
      </button>
      <button id="open-modal" onClick={() => setModal(true)}>
        Open modal
      </button>
      <Select
        label="Fixture selection"
        value={selected}
        onChange={setSelected}
        options={Array.from({ length: 60 }, (_, i) => ({
          value: String(i),
          label: `Option ${i}`,
        }))}
      />
      <div id="shell">
        <header id="toolbar">Application toolbar must stay in place</header>
        <div id="settings-lane" data-settings-scroll-container>
          <div style={{ height: 900 }}>Settings</div>
          <div id="target" data-setting-key="viewport-target">
            Requested setting
          </div>
          <div style={{ height: 900 }} />
        </div>
        <div style={{ height: 400 }} />
      </div>
      <Modal
        isOpen={modal}
        onClose={() => setModal(false)}
        ariaLabel="Viewport fixture modal"
      >
        <button id="modal-first">First action</button>
        <div style={{ height: 1200 }} />
        <button id="modal-last">Last action</button>
      </Modal>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
