import React from "react";
import { FolderOpen, Cloud, Folder, FileText } from "lucide-react";
import { BackupLocationPreset } from "../../../../types/settings";

const locationPresetIcons: Record<BackupLocationPreset, React.ReactNode> = {
  custom: <FolderOpen className="w-4 h-4" />,
  appData: <Folder className="w-4 h-4 text-blue-400" />,
  documents: <FileText className="w-4 h-4 text-yellow-400" />,
  googleDrive: <Cloud className="w-4 h-4 text-green-400" />,
  oneDrive: <Cloud className="w-4 h-4 text-blue-500" />,
  nextcloud: <Cloud className="w-4 h-4 text-cyan-400" />,
  dropbox: <Cloud className="w-4 h-4 text-blue-300" />,
};

export default locationPresetIcons;
