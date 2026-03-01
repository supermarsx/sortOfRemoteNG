/**
 * Built-in script templates shipped with the Script Manager.
 *
 * Extracted from ScriptManager.tsx so the large static data
 * doesn't clutter the component and can be imported independently
 * (e.g. from tests or reset utilities).
 */

import type { ManagedScript } from '../components/recording/scriptManager/shared';

export const defaultScripts: ManagedScript[] = [
  {
    id: 'default-1',
    name: 'System Info (Linux)',
    description: 'Get basic system information on Linux',
    script:
      '#!/bin/bash\nuname -a\ncat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null\nhostname',
    language: 'bash',
    category: 'System',
    osTags: ['linux'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-2',
    name: 'Disk Usage (Linux)',
    description: 'Check disk space usage',
    script:
      '#!/bin/bash\ndf -h\necho ""\necho "Largest directories:"\ndu -sh /* 2>/dev/null | sort -rh | head -10',
    language: 'bash',
    category: 'System',
    osTags: ['linux'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-3',
    name: 'Memory Usage (Linux)',
    description: 'Check memory usage',
    script:
      '#!/bin/bash\nfree -h\necho ""\necho "Top memory consumers:"\nps aux --sort=-%mem | head -10',
    language: 'bash',
    category: 'System',
    osTags: ['linux'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-4',
    name: 'Network Connections (Linux)',
    description: 'Show active network connections',
    script:
      '#!/bin/bash\nnetstat -tuln 2>/dev/null || ss -tuln\necho ""\necho "IP addresses:"\nip addr show | grep -E "inet |inet6 "',
    language: 'bash',
    category: 'Network',
    osTags: ['linux'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-5',
    name: 'System Info (Windows)',
    description: 'Get system information on Windows',
    script:
      'systeminfo | findstr /B /C:"OS Name" /C:"OS Version" /C:"System Type" /C:"Total Physical Memory"\nhostname\nipconfig /all | findstr /C:"IPv4"',
    language: 'powershell',
    category: 'System',
    osTags: ['windows'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-6',
    name: 'Disk Usage (Windows)',
    description: 'Check disk space on Windows',
    script:
      'Get-PSDrive -PSProvider FileSystem | Format-Table Name, @{N="Used(GB)";E={[math]::Round($_.Used/1GB,2)}}, @{N="Free(GB)";E={[math]::Round($_.Free/1GB,2)}}, @{N="Total(GB)";E={[math]::Round(($_.Used+$_.Free)/1GB,2)}} -AutoSize',
    language: 'powershell',
    category: 'System',
    osTags: ['windows'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-7',
    name: 'Service Status (Linux)',
    description: 'Check common service statuses',
    script:
      '#!/bin/bash\nfor service in nginx apache2 httpd mysql mariadb postgresql docker; do\n  if systemctl is-active --quiet $service 2>/dev/null; then\n    echo "$service: RUNNING"\n  elif systemctl is-enabled --quiet $service 2>/dev/null; then\n    echo "$service: STOPPED (enabled)"\n  fi\ndone',
    language: 'bash',
    category: 'Services',
    osTags: ['linux'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-8',
    name: 'Service Status (Windows)',
    description: 'Check important Windows services',
    script:
      'Get-Service | Where-Object {$_.Status -eq "Running"} | Sort-Object DisplayName | Format-Table DisplayName, Status -AutoSize | Select-Object -First 20',
    language: 'powershell',
    category: 'Services',
    osTags: ['windows'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
