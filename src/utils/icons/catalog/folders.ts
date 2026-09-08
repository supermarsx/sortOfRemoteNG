import {
  ArrowLeftRight,
  BriefcaseBusiness,
  createLucideIcon,
  Container,
  Folder,
  FolderOpen,
  FolderArchive,
  FolderClock,
  FolderCode,
  FolderCog,
  FolderGit2,
  FolderHeart,
  FolderKanban,
  FolderLock,
  FolderSync,
  FolderTree,
  Folders,
  Globe,
  HardDriveDownload,
  Layers,
  Mail,
  Monitor,
  Phone,
  Router,
  Server,
  ShieldCheck,
  Terminal,
  UserRound,
  Wifi,
} from "lucide-react";

import { defineIcon } from "./types";
import { createRoleIcon } from "../createRoleIcon";

const SwitchPorts = createLucideIcon("FolderSwitchPorts", [
  [
    "rect",
    { x: "2", y: "6", width: "20", height: "12", rx: "2", key: "chassis" },
  ],
  ["path", { d: "M6 10v4M12 10v4M18 10v4", key: "ports" }],
]);
const StorageBays = createLucideIcon("FolderStorageBays", [
  [
    "rect",
    { x: "3", y: "2", width: "18", height: "20", rx: "2", key: "chassis" },
  ],
  ["path", { d: "M9 2v20M15 2v20M6 17h.01M12 17h.01M18 17h.01", key: "bays" }],
]);

const WorkFolder = createRoleIcon("WorkFolder", "folder", BriefcaseBusiness);
const PersonalFolder = createRoleIcon("PersonalFolder", "folder", UserRound);
const RemoteFolder = createRoleIcon("RemoteFolder", "folder", ArrowLeftRight);
const RdpFolder = createRoleIcon("RdpFolder", "folder", Monitor);
const PhoneFolder = createRoleIcon("PhoneFolder", "folder", Phone);
const SwitchFolder = createRoleIcon("SwitchFolder", "folder", SwitchPorts);
const RouterFolder = createRoleIcon("RouterFolder", "folder", Router);
const WebFolder = createRoleIcon("WebFolder", "folder", Globe);
const AdminFolder = createRoleIcon("AdminFolder", "folder", ShieldCheck);
const SshFolder = createRoleIcon("SshFolder", "folder", Terminal);
const ServerFolder = createRoleIcon("ServerFolder", "folder", Server);
const NasFolder = createRoleIcon("NasFolder", "folder", StorageBays);
const AccessPointFolder = createRoleIcon("AccessPointFolder", "folder", Wifi);
const DirectoryFolder = createRoleIcon("DirectoryFolder", "folder", Folders);
const FileServerFolder = createRoleIcon(
  "FileServerFolder",
  "folder",
  HardDriveDownload,
);
const MailServerFolder = createRoleIcon("MailServerFolder", "folder", Mail);
const ContainerServerFolder = createRoleIcon(
  "ContainerServerFolder",
  "folder",
  Container,
);
const HypervisorFolder = createRoleIcon("HypervisorFolder", "folder", Layers);

export const FOLDER_ICONS = [
  defineIcon("folder", "Folder", "folders", Folder, [
    "group",
    "directory",
    "files",
  ]),
  defineIcon("folder-open", "Open folder", "folders", FolderOpen, [
    "directory",
    "browse",
    "files",
  ]),
  defineIcon("folder-cog", "Servers folder", "folders", FolderCog, [
    "servers",
    "settings",
    "infrastructure",
    "devices",
  ]),
  defineIcon("folder-tree", "Network folder", "folders", FolderTree, [
    "network",
    "hierarchy",
    "sites",
    "groups",
  ]),
  defineIcon("folder-lock", "Secure folder", "folders", FolderLock, [
    "security",
    "protected",
    "private",
  ]),
  defineIcon("folder-archive", "Archive folder", "folders", FolderArchive, [
    "archive",
    "backups",
    "storage",
    "database",
  ]),
  defineIcon("folder-code", "Development folder", "folders", FolderCode, [
    "development",
    "code",
    "scripts",
  ]),
  defineIcon("folder-git", "Repository folder", "folders", FolderGit2, [
    "git",
    "repository",
    "version control",
  ]),
  defineIcon("folder-sync", "Synced folder", "folders", FolderSync, [
    "cloud",
    "sync",
    "replication",
  ]),
  defineIcon("folder-clock", "Scheduled folder", "folders", FolderClock, [
    "schedule",
    "history",
    "maintenance",
  ]),
  defineIcon("folder-kanban", "Projects folder", "folders", FolderKanban, [
    "projects",
    "tasks",
    "workflow",
  ]),
  defineIcon("folder-heart", "Favorites folder", "folders", FolderHeart, [
    "favorites",
    "important",
    "personal",
  ]),
  defineIcon("folder-work", "Work folder", "folders", WorkFolder, [
    "work",
    "office",
    "business",
    "company",
  ]),
  defineIcon("folder-personal", "Personal folder", "folders", PersonalFolder, [
    "personal",
    "home",
    "private",
    "user",
  ]),
  defineIcon(
    "folder-remote",
    "Remote connections folder",
    "folders",
    RemoteFolder,
    ["remote", "connections", "sessions", "remote access"],
  ),
  defineIcon("folder-rdp", "RDP folder", "folders", RdpFolder, [
    "rdp",
    "remote desktop",
    "windows desktop",
  ]),
  defineIcon("folder-phone", "Phone folder", "folders", PhoneFolder, [
    "phone",
    "voip",
    "telephony",
    "sip",
  ]),
  defineIcon("folder-switch", "Switches folder", "folders", SwitchFolder, [
    "switch",
    "switches",
    "ethernet",
    "ports",
  ]),
  defineIcon("folder-router", "Routers folder", "folders", RouterFolder, [
    "router",
    "routers",
    "gateway",
    "routing",
  ]),
  defineIcon("folder-web", "Web folder", "folders", WebFolder, [
    "web",
    "http",
    "https",
    "websites",
    "browser",
  ]),
  defineIcon("folder-admin", "Administration folder", "folders", AdminFolder, [
    "admin",
    "administration",
    "management",
    "privileged",
  ]),
  defineIcon("folder-ssh", "SSH folder", "folders", SshFolder, [
    "ssh",
    "shell",
    "terminal",
    "secure shell",
  ]),
  defineIcon(
    "folder-server",
    "Server connections folder",
    "folders",
    ServerFolder,
    ["server", "servers", "rack", "host", "datacenter"],
  ),
  defineIcon("folder-nas", "NAS folder", "folders", NasFolder, [
    "nas",
    "network attached storage",
    "storage",
    "file shares",
  ]),
  defineIcon(
    "folder-access-point",
    "Access points folder",
    "folders",
    AccessPointFolder,
    ["access point", "access points", "ap", "wifi", "wireless"],
  ),
  defineIcon(
    "folder-directory",
    "Directories folder",
    "folders",
    DirectoryFolder,
    [
      "directory",
      "directories",
      "directory folder",
      "folders",
      "paths",
      "filesystem",
      "hierarchy",
    ],
  ),
  defineIcon(
    "folder-file-server",
    "File servers folder",
    "folders",
    FileServerFolder,
    [
      "file server",
      "file servers",
      "fileserver",
      "file shares",
      "smb",
      "nfs",
      "storage",
      "folders",
    ],
  ),
  defineIcon(
    "folder-mail-server",
    "Mail servers folder",
    "folders",
    MailServerFolder,
    [
      "mail server",
      "mail servers",
      "email",
      "smtp",
      "imap",
      "exchange",
      "folders",
    ],
  ),
  defineIcon(
    "folder-container-server",
    "Container servers folder",
    "folders",
    ContainerServerFolder,
    [
      "container server",
      "container servers",
      "containers",
      "docker",
      "podman",
      "container host",
      "folders",
    ],
  ),
  defineIcon(
    "folder-hypervisor",
    "Hypervisors folder",
    "folders",
    HypervisorFolder,
    [
      "hypervisor",
      "hypervisors",
      "virtualization",
      "virtual machines",
      "vmware",
      "hyper-v",
      "kvm",
      "folders",
    ],
  ),
] as const;
