import React from "react";
import { TrustWarningDialog } from "../../security/TrustWarningDialog";
import { InputDialog } from "../../shared/InputDialog";
import { ConfirmDialog } from "../../shared/ConfirmDialog";

const BrowserDialogs: React.FC<SectionProps> = ({ mgr }) => (
  <>
    {mgr.trustPrompt && mgr.certIdentity && (
      <TrustWarningDialog
        type="tls"
        host={mgr.session.hostname}
        port={mgr.connection?.port || 443}
        reason={
          mgr.trustPrompt.status === "mismatch" ? "mismatch" : "first-use"
        }
        receivedIdentity={mgr.certIdentity}
        storedIdentity={
          mgr.trustPrompt.status === "mismatch"
            ? mgr.trustPrompt.stored
            : undefined
        }
        onAccept={mgr.handleTrustAccept}
        onReject={mgr.handleTrustReject}
      />
    )}
    <InputDialog
      isOpen={mgr.showNewFolderDialog}
      title="New Folder"
      message="Enter a name for the new bookmark folder:"
      placeholder="Folder name"
      confirmText="Create"
      onConfirm={mgr.confirmAddFolder}
      onCancel={() => mgr.setShowNewFolderDialog(false)}
    />
    <ConfirmDialog
      isOpen={mgr.showDeleteAllConfirm}
      title="Delete All Bookmarks"
      message="Are you sure you want to delete all bookmarks for this connection? This cannot be undone."
      confirmText="Delete All"
      variant="danger"
      onConfirm={mgr.confirmDeleteAllBookmarks}
      onCancel={() => mgr.setShowDeleteAllConfirm(false)}
    />
    {mgr.showRecordingNamePrompt && (
      <InputDialog
        isOpen={true}
        title={
          mgr.showRecordingNamePrompt === "har"
            ? "Save Web Recording"
            : "Save Video Recording"
        }
        message="Enter a name for this recording:"
        defaultValue={`${mgr.connection?.name || mgr.session.hostname} - ${new Date().toLocaleString()}`}
        onConfirm={(name) => {
          if (mgr.showRecordingNamePrompt === "har") {
            mgr.handleSaveHarRecording(name);
          } else {
            mgr.handleSaveVideoRecording(name);
          }
        }}
        onCancel={() => {
          mgr.pendingRecordingRef.current = null;
          mgr.setShowRecordingNamePrompt(null);
        }}
      />
    )}
  </>
);

export default BrowserDialogs;
