import React from "react";
import { FolderOpen, Cloud, Folder, FileText } from "lucide-react";
import { BackupLocationPreset } from "../../../../types/settings/settings";

const locationPresetIcons: Record<BackupLocationPreset, React.ReactNode> = {
  custom: <FolderOpen className="w-4 h-4" />,
  appData: <Folder className="w-4 h-4 text-primary" />,
  documents: <FileText className="w-4 h-4 text-warning" />,
  googleDrive: <Cloud className="w-4 h-4 text-success" />,
  oneDrive: <Cloud className="w-4 h-4 text-primary" />,
  nextcloud: <Cloud className="w-4 h-4 text-info" />,
  dropbox: <Cloud className="w-4 h-4 text-primary" />,
};

export default locationPresetIcons;
