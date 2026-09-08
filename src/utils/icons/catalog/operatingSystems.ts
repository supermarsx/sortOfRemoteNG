import { Computer, Disc3, MonitorSmartphone } from "lucide-react";

import {
  almalinux,
  android,
  centos,
  debian,
  fedora,
  freebsd,
  linux,
  macos,
  opensuse,
  redhat,
  rockylinux,
  ubuntu,
  windows,
} from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

/**
 * Operating system icons. Seeded with generic Lucide entries so the category is
 * never empty; brand marks (Linux, Ubuntu, macOS, Windows, ...) are appended by
 * later work without touching the entries below.
 */
export const OPERATING_SYSTEM_ICONS = [
  defineIcon("computer", "Computer", "operating-systems", Computer, [
    "computer",
    "pc",
    "generic computer",
    "workstation",
    "machine",
  ]),
  defineIcon("generic-os", "Operating system", "operating-systems", Disc3, [
    "os",
    "operating system",
    "platform",
    "image",
    "iso",
  ]),
  defineIcon(
    "cross-platform",
    "Cross-platform",
    "operating-systems",
    MonitorSmartphone,
    ["cross platform", "multi platform", "portable", "mobile", "os"],
  ),
  defineIcon("redhat", "Red Hat", "operating-systems", redhat, [
    "redhat",
    "red hat",
    "rhel",
    "enterprise linux",
  ]),
  defineIcon(
    "redhat-server",
    "Red Hat server",
    "operating-systems",
    createRoleIcon("RedHatServer", "server", redhat),
    ["redhat", "red hat", "rhel", "linux server"],
  ),
  defineIcon("centos", "CentOS", "operating-systems", centos, [
    "centos",
    "cent os",
    "centos stream",
    "linux",
  ]),
  defineIcon(
    "centos-server",
    "CentOS server",
    "operating-systems",
    createRoleIcon("CentOSServer", "server", centos),
    ["centos", "centos stream", "linux server"],
  ),
  defineIcon("ubuntu", "Ubuntu", "operating-systems", ubuntu, [
    "ubuntu",
    "canonical",
    "linux",
  ]),
  defineIcon(
    "ubuntu-server",
    "Ubuntu Server",
    "operating-systems",
    createRoleIcon("UbuntuServer", "server", ubuntu),
    ["ubuntu", "canonical", "linux server"],
  ),
  defineIcon("fedora", "Fedora", "operating-systems", fedora, [
    "fedora",
    "linux",
    "workstation",
    "red hat",
  ]),
  defineIcon("macos", "macOS", "operating-systems", macos, [
    "macos",
    "mac os",
    "osx",
    "os x",
    "apple",
  ]),
  defineIcon("windows", "Windows", "operating-systems", windows, [
    "windows",
    "microsoft",
    "win10",
    "win11",
  ]),
  defineIcon("freebsd", "FreeBSD", "operating-systems", freebsd, [
    "freebsd",
    "free bsd",
    "bsd",
    "unix",
  ]),
  defineIcon(
    "freebsd-server",
    "FreeBSD server",
    "operating-systems",
    createRoleIcon("FreeBSDServer", "server", freebsd),
    ["freebsd", "free bsd", "bsd server", "unix server"],
  ),
  defineIcon("linux", "Linux", "operating-systems", linux, [
    "generic linux",
    "linux",
    "tux",
    "gnu",
    "kernel",
  ]),
  defineIcon("android", "Android", "operating-systems", android, [
    "android",
    "google",
    "mobile os",
  ]),
  defineIcon("debian", "Debian", "operating-systems", debian, [
    "debian",
    "linux",
    "apt",
  ]),
  defineIcon("rocky-linux", "Rocky Linux", "operating-systems", rockylinux, [
    "rocky",
    "rockylinux",
    "rocky linux",
    "rhel",
  ]),
  defineIcon("almalinux", "AlmaLinux", "operating-systems", almalinux, [
    "alma",
    "almalinux",
    "alma linux",
    "rhel",
  ]),
  defineIcon("opensuse", "openSUSE", "operating-systems", opensuse, [
    "opensuse",
    "open suse",
    "suse",
    "tumbleweed",
    "leap",
  ]),
  defineIcon(
    "windows-server",
    "Windows Server",
    "operating-systems",
    createRoleIcon("WindowsServer", "server", windows),
    ["windows server", "microsoft windows", "win server"],
  ),
  defineIcon(
    "linux-server",
    "Linux server",
    "operating-systems",
    createRoleIcon("LinuxServer", "server", linux),
    ["linux server", "generic linux server", "linuxserver", "unix"],
  ),
  defineIcon(
    "macos-server",
    "macOS server",
    "operating-systems",
    createRoleIcon("MacOSServer", "server", macos),
    ["macos server", "mac os server", "apple server", "os x server"],
  ),
] as const;
