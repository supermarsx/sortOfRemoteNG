export const serviceMap: Record<number, { service: string; protocol: string }> = {
  21: { service: 'ftp', protocol: 'ftp' },
  22: { service: 'ssh', protocol: 'ssh' },
  23: { service: 'telnet', protocol: 'telnet' },
  25: { service: 'smtp', protocol: 'smtp' },
  53: { service: 'dns', protocol: 'dns' },
  80: { service: 'http', protocol: 'http' },
  110: { service: 'pop3', protocol: 'pop3' },
  143: { service: 'imap', protocol: 'imap' },
  443: { service: 'https', protocol: 'https' },
  993: { service: 'imaps', protocol: 'imaps' },
  995: { service: 'pop3s', protocol: 'pop3s' },
  3306: { service: 'mysql', protocol: 'mysql' },
  3389: { service: 'rdp', protocol: 'rdp' },
  5432: { service: 'postgresql', protocol: 'postgresql' },
  5900: { service: 'vnc', protocol: 'vnc' },
  5901: { service: 'vnc', protocol: 'vnc' },
  5902: { service: 'vnc', protocol: 'vnc' },
};

export default serviceMap;
