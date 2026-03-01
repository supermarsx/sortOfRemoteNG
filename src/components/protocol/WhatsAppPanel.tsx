import { TabId, TABS } from "./whatsApp/types";
import StatusBadge from "./whatsApp/StatusBadge";
import ErrorMsg from "./whatsApp/ErrorMsg";
import LoadingSpinner from "./whatsApp/LoadingSpinner";
import SettingsTab from "./whatsApp/SettingsTab";
import ComposeTab from "./whatsApp/ComposeTab";
import ChatTab from "./whatsApp/ChatTab";
import TemplatesTab from "./whatsApp/TemplatesTab";
import MediaTab from "./whatsApp/MediaTab";
import ContactsTab from "./whatsApp/ContactsTab";
import PairingTab from "./whatsApp/PairingTab";

export const WhatsAppPanel: React.FC<WhatsAppPanelProps> = ({ className }) => {
  const waHook = useWhatsApp();
  const [activeTab, setActiveTab] = useState<TabId>("chat");

  const renderTab = () => {
    switch (activeTab) {
      case "chat":
        return <ChatTab wa={waHook} />;
      case "compose":
        return <ComposeTab wa={waHook} />;
      case "templates":
        return <TemplatesTab wa={waHook} />;
      case "media":
        return <MediaTab wa={waHook} />;
      case "contacts":
        return <ContactsTab wa={waHook} />;
      case "pairing":
        return <PairingTab wa={waHook} />;
      case "settings":
        return <SettingsTab wa={waHook} />;
    }
  };

  return (
    <div className={`flex flex-col h-full bg-[var(--color-surface)] ${className ?? ""}`}>
      {/* Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <MessageCircle size={20} className="text-green-400" />
          <span className="text-[var(--color-text)] font-medium">WhatsApp</span>
          {waHook.configured && (
            <span className="text-xs px-2 py-0.5 bg-green-900 text-green-300 rounded">
              Connected
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-[var(--color-textSecondary)]">
            {waHook.sessions.length} session{waHook.sessions.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={waHook.refreshSessions}
            className="sor-icon-btn-sm"
            title="Refresh sessions"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[var(--color-border)] overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-1.5 px-4 py-2.5 text-xs whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "bg-green-800/30 text-green-400 border-b-2 border-green-400"
                  : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">{renderTab()}</div>
    </div>
  );
};

export default WhatsAppPanel;

