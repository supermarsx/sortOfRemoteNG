/**
 * MAC Address Vendor Lookup Service
 * 
 * Uses multiple sources to identify the manufacturer/vendor of a network device
 * based on its MAC address (first 3 octets = OUI - Organizationally Unique Identifier)
 */

// Common MAC address vendor prefixes (OUI database)
// This is a curated list of the most common vendors
const MAC_VENDORS: Record<string, string> = {
  // Apple
  "00:03:93": "Apple",
  "00:0A:27": "Apple",
  "00:0A:95": "Apple",
  "00:0D:93": "Apple",
  "00:10:FA": "Apple",
  "00:11:24": "Apple",
  "00:14:51": "Apple",
  "00:16:CB": "Apple",
  "00:17:F2": "Apple",
  "00:19:E3": "Apple",
  "00:1B:63": "Apple",
  "00:1C:B3": "Apple",
  "00:1D:4F": "Apple",
  "00:1E:52": "Apple",
  "00:1E:C2": "Apple",
  "00:1F:5B": "Apple",
  "00:1F:F3": "Apple",
  "00:21:E9": "Apple",
  "00:22:41": "Apple",
  "00:23:12": "Apple",
  "00:23:32": "Apple",
  "00:23:6C": "Apple",
  "00:23:DF": "Apple",
  "00:24:36": "Apple",
  "00:25:00": "Apple",
  "00:25:4B": "Apple",
  "00:25:BC": "Apple",
  "00:26:08": "Apple",
  "00:26:4A": "Apple",
  "00:26:B0": "Apple",
  "00:26:BB": "Apple",
  "00:30:65": "Apple",
  "00:3E:E1": "Apple",
  "00:50:E4": "Apple",
  "00:56:CD": "Apple",
  "00:61:71": "Apple",
  "00:6D:52": "Apple",
  "00:88:65": "Apple",
  "00:B3:62": "Apple",
  "00:C6:10": "Apple",
  "00:CD:FE": "Apple",
  "00:DB:70": "Apple",
  "00:F4:B9": "Apple",
  "00:F7:6F": "Apple",
  "04:0C:CE": "Apple",
  "04:15:52": "Apple",
  "04:1B:BA": "Apple",
  "04:26:65": "Apple",
  "04:48:9A": "Apple",
  "04:4B:ED": "Apple",
  "04:52:F3": "Apple",
  "04:54:53": "Apple",
  "04:69:F8": "Apple",
  "04:D3:CF": "Apple",
  "04:DB:56": "Apple",
  "04:E5:36": "Apple",
  "04:F1:3E": "Apple",
  "04:F7:E4": "Apple",
  
  // Microsoft / Xbox
  "00:03:FF": "Microsoft",
  "00:0D:3A": "Microsoft",
  "00:12:5A": "Microsoft",
  "00:15:5D": "Microsoft",
  "00:17:FA": "Microsoft",
  "00:1D:D8": "Microsoft",
  "00:22:48": "Microsoft",
  "00:25:AE": "Microsoft",
  "00:50:F2": "Microsoft",
  "28:18:78": "Microsoft",
  "30:59:B7": "Microsoft",
  "50:1A:C5": "Microsoft",
  "58:82:A8": "Microsoft",
  "60:45:BD": "Microsoft",
  "7C:1E:52": "Microsoft",
  "7C:ED:8D": "Microsoft",
  "98:5F:D3": "Microsoft",
  "B4:0E:DE": "Microsoft",
  "C8:3F:26": "Microsoft",
  "D4:81:D7": "Microsoft",
  
  // Dell
  "00:06:5B": "Dell",
  "00:08:74": "Dell",
  "00:0B:DB": "Dell",
  "00:0D:56": "Dell",
  "00:0F:1F": "Dell",
  "00:11:43": "Dell",
  "00:12:3F": "Dell",
  "00:13:72": "Dell",
  "00:14:22": "Dell",
  "00:15:C5": "Dell",
  "00:16:F0": "Dell",
  "00:18:8B": "Dell",
  "00:19:B9": "Dell",
  "00:1A:A0": "Dell",
  "00:1C:23": "Dell",
  "00:1D:09": "Dell",
  "00:1E:4F": "Dell",
  "00:1E:C9": "Dell",
  "00:21:70": "Dell",
  "00:21:9B": "Dell",
  "00:22:19": "Dell",
  "00:23:AE": "Dell",
  "00:24:E8": "Dell",
  "00:25:64": "Dell",
  "00:26:B9": "Dell",
  "14:18:77": "Dell",
  "14:9E:CF": "Dell",
  "14:B3:1F": "Dell",
  "18:03:73": "Dell",
  "18:66:DA": "Dell",
  "18:A9:9B": "Dell",
  "18:DB:F2": "Dell",
  "1C:40:24": "Dell",
  "20:47:47": "Dell",
  "24:B6:FD": "Dell",
  "28:F1:0E": "Dell",
  "34:17:EB": "Dell",
  "34:E6:D7": "Dell",
  
  // HP / Hewlett Packard
  "00:01:E6": "HP",
  "00:01:E7": "HP",
  "00:02:A5": "HP",
  "00:04:EA": "HP",
  "00:08:02": "HP",
  "00:08:83": "HP",
  "00:0A:57": "HP",
  "00:0B:CD": "HP",
  "00:0D:9D": "HP",
  "00:0E:7F": "HP",
  "00:0F:20": "HP",
  "00:0F:61": "HP",
  "00:10:83": "HP",
  "00:10:E3": "HP",
  "00:11:0A": "HP",
  "00:11:85": "HP",
  "00:12:79": "HP",
  "00:13:21": "HP",
  "00:14:38": "HP",
  "00:14:C2": "HP",
  "00:15:60": "HP",
  "00:16:35": "HP",
  "00:17:08": "HP",
  "00:17:A4": "HP",
  "00:18:71": "HP",
  "00:18:FE": "HP",
  "00:19:BB": "HP",
  "00:1A:4B": "HP",
  "00:1B:78": "HP",
  "00:1C:C4": "HP",
  "00:1E:0B": "HP",
  "00:1F:29": "HP",
  "00:21:5A": "HP",
  "00:22:64": "HP",
  "00:23:7D": "HP",
  "00:24:81": "HP",
  "00:25:B3": "HP",
  "00:26:55": "HP",
  "00:27:0D": "HP",
  
  // Intel
  "00:02:B3": "Intel",
  "00:03:47": "Intel",
  "00:04:23": "Intel",
  "00:07:E9": "Intel",
  "00:0C:F1": "Intel",
  "00:0E:0C": "Intel",
  "00:0E:35": "Intel",
  "00:11:11": "Intel",
  "00:12:F0": "Intel",
  "00:13:02": "Intel",
  "00:13:20": "Intel",
  "00:13:CE": "Intel",
  "00:13:E8": "Intel",
  "00:15:00": "Intel",
  "00:15:17": "Intel",
  "00:16:6F": "Intel",
  "00:16:76": "Intel",
  "00:16:EA": "Intel",
  "00:16:EB": "Intel",
  "00:18:DE": "Intel",
  "00:19:D1": "Intel",
  "00:19:D2": "Intel",
  "00:1B:21": "Intel",
  "00:1B:77": "Intel",
  "00:1C:BF": "Intel",
  "00:1C:C0": "Intel",
  "00:1D:E0": "Intel",
  "00:1D:E1": "Intel",
  "00:1E:64": "Intel",
  "00:1E:65": "Intel",
  "00:1E:67": "Intel",
  "00:1F:3B": "Intel",
  "00:1F:3C": "Intel",
  "00:20:E0": "Intel",
  "00:21:5C": "Intel",
  "00:21:5D": "Intel",
  "00:21:6A": "Intel",
  "00:21:6B": "Intel",
  "00:22:FA": "Intel",
  "00:22:FB": "Intel",
  "00:24:D6": "Intel",
  "00:24:D7": "Intel",
  "00:26:C6": "Intel",
  "00:26:C7": "Intel",
  "00:27:10": "Intel",
  
  // Cisco
  "00:00:0C": "Cisco",
  "00:01:42": "Cisco",
  "00:01:43": "Cisco",
  "00:01:63": "Cisco",
  "00:01:64": "Cisco",
  "00:01:96": "Cisco",
  "00:01:97": "Cisco",
  "00:01:C7": "Cisco",
  "00:01:C9": "Cisco",
  "00:02:16": "Cisco",
  "00:02:17": "Cisco",
  "00:02:3D": "Cisco",
  "00:02:4A": "Cisco",
  "00:02:4B": "Cisco",
  "00:02:7D": "Cisco",
  "00:02:7E": "Cisco",
  "00:02:B9": "Cisco",
  "00:02:BA": "Cisco",
  "00:02:FC": "Cisco",
  "00:02:FD": "Cisco",
  "00:03:31": "Cisco",
  "00:03:32": "Cisco",
  "00:03:6B": "Cisco",
  "00:03:6C": "Cisco",
  "00:03:9F": "Cisco",
  "00:03:A0": "Cisco",
  "00:03:E3": "Cisco",
  "00:03:E4": "Cisco",
  "00:03:FD": "Cisco",
  "00:03:FE": "Cisco",
  "00:04:27": "Cisco",
  "00:04:28": "Cisco",
  "00:04:4D": "Cisco",
  "00:04:4E": "Cisco",
  "00:04:6D": "Cisco",
  "00:04:6E": "Cisco",
  "00:04:9A": "Cisco",
  "00:04:9B": "Cisco",
  "00:04:C0": "Cisco",
  "00:04:C1": "Cisco",
  "00:04:DD": "Cisco",
  "00:04:DE": "Cisco",
  
  // Samsung
  "00:00:F0": "Samsung",
  "00:07:AB": "Samsung",
  "00:09:18": "Samsung",
  "00:0D:AE": "Samsung",
  "00:12:47": "Samsung",
  "00:12:FB": "Samsung",
  "00:13:77": "Samsung",
  "00:15:99": "Samsung",
  "00:15:B9": "Samsung",
  "00:16:32": "Samsung",
  "00:16:6B": "Samsung",
  "00:16:6C": "Samsung",
  "00:16:DB": "Samsung",
  "00:17:C9": "Samsung",
  "00:17:D5": "Samsung",
  "00:18:AF": "Samsung",
  "00:1A:8A": "Samsung",
  "00:1B:98": "Samsung",
  "00:1C:43": "Samsung",
  "00:1D:25": "Samsung",
  "00:1D:F6": "Samsung",
  "00:1E:7D": "Samsung",
  "00:1E:E1": "Samsung",
  "00:1E:E2": "Samsung",
  "00:1F:CC": "Samsung",
  "00:1F:CD": "Samsung",
  "00:21:19": "Samsung",
  "00:21:4C": "Samsung",
  "00:21:D1": "Samsung",
  "00:21:D2": "Samsung",
  "00:23:39": "Samsung",
  "00:23:3A": "Samsung",
  "00:23:99": "Samsung",
  "00:23:D6": "Samsung",
  "00:23:D7": "Samsung",
  "00:24:54": "Samsung",
  "00:24:90": "Samsung",
  "00:24:91": "Samsung",
  "00:24:E9": "Samsung",
  "00:25:38": "Samsung",
  "00:25:66": "Samsung",
  "00:25:67": "Samsung",
  "00:26:37": "Samsung",
  "00:26:5D": "Samsung",
  "00:26:5F": "Samsung",
  
  // ASUS / ASUSTek
  "00:0C:6E": "ASUS",
  "00:0E:A6": "ASUS",
  "00:11:2F": "ASUS",
  "00:11:D8": "ASUS",
  "00:13:D4": "ASUS",
  "00:15:F2": "ASUS",
  "00:17:31": "ASUS",
  "00:18:F3": "ASUS",
  "00:1A:92": "ASUS",
  "00:1B:FC": "ASUS",
  "00:1D:60": "ASUS",
  "00:1E:8C": "ASUS",
  "00:1F:C6": "ASUS",
  "00:22:15": "ASUS",
  "00:23:54": "ASUS",
  "00:24:8C": "ASUS",
  "00:25:22": "ASUS",
  "00:26:18": "ASUS",
  "00:26:6C": "ASUS",
  "04:92:26": "ASUS",
  "08:60:6E": "ASUS",
  "10:7B:44": "ASUS",
  "10:BF:48": "ASUS",
  "10:C3:7B": "ASUS",
  "14:DA:E9": "ASUS",
  "14:DD:A9": "ASUS",
  "1C:87:2C": "ASUS",
  "1C:B7:2C": "ASUS",
  "20:CF:30": "ASUS",
  "24:4B:FE": "ASUS",
  "2C:4D:54": "ASUS",
  "2C:56:DC": "ASUS",
  "30:5A:3A": "ASUS",
  "30:85:A9": "ASUS",
  "34:97:F6": "ASUS",
  
  // Lenovo
  "00:09:2D": "Lenovo",
  "00:0B:82": "Lenovo",
  "00:16:41": "Lenovo",
  "00:1A:6B": "Lenovo",
  "00:1E:4C": "Lenovo",
  "00:21:5E": "Lenovo",
  "00:22:4D": "Lenovo",
  "00:23:7D": "Lenovo",
  "00:24:7E": "Lenovo",
  "00:26:2D": "Lenovo",
  "08:9E:01": "Lenovo",
  "10:68:3F": "Lenovo",
  "20:89:84": "Lenovo",
  "28:D2:44": "Lenovo",
  "2C:BE:08": "Lenovo",
  "34:E6:AD": "Lenovo",
  "38:DE:AD": "Lenovo",
  "3C:97:0E": "Lenovo",
  "40:F0:2F": "Lenovo",
  "50:7B:9D": "Lenovo",
  "54:EE:75": "Lenovo",
  "5C:B9:01": "Lenovo",
  "60:02:B4": "Lenovo",
  "60:D9:C7": "Lenovo",
  "6C:C2:17": "Lenovo",
  "70:5A:0F": "Lenovo",
  "74:70:FD": "Lenovo",
  "74:E5:0B": "Lenovo",
  "78:E4:00": "Lenovo",
  "7C:7A:91": "Lenovo",
  "84:7B:EB": "Lenovo",
  "88:70:8C": "Lenovo",
  "98:FA:9B": "Lenovo",
  "9C:7B:EF": "Lenovo",
  "A4:4C:C8": "Lenovo",
  "AC:16:2D": "Lenovo",
  "B4:40:A4": "Lenovo",
  
  // Netgear
  "00:09:5B": "Netgear",
  "00:0F:B5": "Netgear",
  "00:14:6C": "Netgear",
  "00:18:4D": "Netgear",
  "00:1B:2F": "Netgear",
  "00:1E:2A": "Netgear",
  "00:1F:33": "Netgear",
  "00:22:3F": "Netgear",
  "00:24:B2": "Netgear",
  "00:26:F2": "Netgear",
  "10:0D:7F": "Netgear",
  "10:0C:6B": "Netgear",
  "20:0C:C8": "Netgear",
  "20:4E:7F": "Netgear",
  "28:C6:8E": "Netgear",
  "2C:B0:5D": "Netgear",
  "30:46:9A": "Netgear",
  "30:B5:C2": "Netgear",
  "44:94:FC": "Netgear",
  "4C:60:DE": "Netgear",
  "54:07:7D": "Netgear",
  "58:EF:68": "Netgear",
  "6C:B0:CE": "Netgear",
  "80:37:73": "Netgear",
  "84:1B:5E": "Netgear",
  "9C:3D:CF": "Netgear",
  "A0:04:60": "Netgear",
  "A0:21:B7": "Netgear",
  "A4:2B:8C": "Netgear",
  "B0:7F:B9": "Netgear",
  "C0:3F:0E": "Netgear",
  "C4:04:15": "Netgear",
  "C8:9E:43": "Netgear",
  "CC:40:D0": "Netgear",
  "DC:EF:09": "Netgear",
  "E0:46:9A": "Netgear",
  "E0:91:F5": "Netgear",
  "E4:F4:C6": "Netgear",
  "E8:FC:AF": "Netgear",
  "F8:E9:03": "Netgear",
  
  // TP-Link
  "00:1D:0F": "TP-Link",
  "00:23:CD": "TP-Link",
  "00:27:19": "TP-Link",
  "14:CC:20": "TP-Link",
  "14:CF:92": "TP-Link",
  "14:E6:E4": "TP-Link",
  "18:A6:F7": "TP-Link",
  "1C:3B:F3": "TP-Link",
  "24:69:68": "TP-Link",
  "30:B5:C2": "TP-Link",
  "30:DE:4B": "TP-Link",
  "34:E8:94": "TP-Link",
  "40:16:9F": "TP-Link",
  "50:3E:AA": "TP-Link",
  "50:C7:BF": "TP-Link",
  "54:C8:0F": "TP-Link",
  "5C:89:9A": "TP-Link",
  "60:E3:27": "TP-Link",
  "64:56:01": "TP-Link",
  "64:66:B3": "TP-Link",
  "64:70:02": "TP-Link",
  "6C:3B:6B": "TP-Link",
  "74:DA:88": "TP-Link",
  "74:EA:3A": "TP-Link",
  "78:A1:06": "TP-Link",
  "7C:8B:CA": "TP-Link",
  "84:16:F9": "TP-Link",
  "88:1F:A1": "TP-Link",
  "90:F6:52": "TP-Link",
  "94:0C:6D": "TP-Link",
  "98:DA:C4": "TP-Link",
  "A0:F3:C1": "TP-Link",
  "AC:84:C6": "TP-Link",
  "B0:4E:26": "TP-Link",
  "B0:95:75": "TP-Link",
  "B4:B0:24": "TP-Link",
  "BC:46:99": "TP-Link",
  "C0:25:E9": "TP-Link",
  "C0:4A:00": "TP-Link",
  "C4:6E:1F": "TP-Link",
  "C8:3A:35": "TP-Link",
  "D4:6E:0E": "TP-Link",
  "D8:07:B6": "TP-Link",
  "D8:5D:4C": "TP-Link",
  "E4:D3:32": "TP-Link",
  "E8:DE:27": "TP-Link",
  "EC:08:6B": "TP-Link",
  "EC:17:2F": "TP-Link",
  "F0:F3:36": "TP-Link",
  "F4:EC:38": "TP-Link",
  "F4:F2:6D": "TP-Link",
  "F8:1A:67": "TP-Link",
  "F8:C0:91": "TP-Link",
  "FC:EC:DA": "TP-Link",
  
  // D-Link
  "00:05:5D": "D-Link",
  "00:0D:88": "D-Link",
  "00:0F:3D": "D-Link",
  "00:11:95": "D-Link",
  "00:13:46": "D-Link",
  "00:15:E9": "D-Link",
  "00:17:9A": "D-Link",
  "00:19:5B": "D-Link",
  "00:1B:11": "D-Link",
  "00:1C:F0": "D-Link",
  "00:1E:58": "D-Link",
  "00:1F:5F": "D-Link",
  "00:21:91": "D-Link",
  "00:22:B0": "D-Link",
  "00:24:01": "D-Link",
  "00:26:5A": "D-Link",
  "00:27:1C": "D-Link",
  "1C:7E:E5": "D-Link",
  "1C:AF:F7": "D-Link",
  "28:10:7B": "D-Link",
  "34:08:04": "D-Link",
  "3C:1E:04": "D-Link",
  "5C:D9:98": "D-Link",
  "64:D1:A3": "D-Link",
  "78:32:1B": "D-Link",
  "78:54:2E": "D-Link",
  "84:C9:B2": "D-Link",
  "90:8D:78": "D-Link",
  "90:94:E4": "D-Link",
  "9C:D6:43": "D-Link",
  "A0:AB:1B": "D-Link",
  "AC:F1:DF": "D-Link",
  "B8:A3:86": "D-Link",
  "BC:F6:85": "D-Link",
  "C0:A0:BB": "D-Link",
  "C4:12:F5": "D-Link",
  "C4:A8:1D": "D-Link",
  "C8:BE:19": "D-Link",
  "CC:B2:55": "D-Link",
  "D8:FE:E3": "D-Link",
  "E4:6F:13": "D-Link",
  "E8:CC:18": "D-Link",
  "F0:7D:68": "D-Link",
  
  // Linksys
  "00:04:5A": "Linksys",
  "00:06:25": "Linksys",
  "00:0C:41": "Linksys",
  "00:0E:08": "Linksys",
  "00:0F:66": "Linksys",
  "00:12:17": "Linksys",
  "00:13:10": "Linksys",
  "00:14:BF": "Linksys",
  "00:16:B6": "Linksys",
  "00:18:39": "Linksys",
  "00:18:F8": "Linksys",
  "00:1A:70": "Linksys",
  "00:1C:10": "Linksys",
  "00:1D:7E": "Linksys",
  "00:1E:E5": "Linksys",
  "00:21:29": "Linksys",
  "00:22:6B": "Linksys",
  "00:23:69": "Linksys",
  "00:25:9C": "Linksys",
  "14:35:8B": "Linksys",
  "20:AA:4B": "Linksys",
  "24:01:C7": "Linksys",
  "4C:F2:BF": "Linksys",
  "58:6D:8F": "Linksys",
  "68:7F:74": "Linksys",
  "84:94:8C": "Linksys",
  "98:FC:11": "Linksys",
  "B4:75:0E": "Linksys",
  "C0:56:27": "Linksys",
  "C8:D7:19": "Linksys",
  "D4:20:6D": "Linksys",
  "E0:60:66": "Linksys",
  "E4:32:CB": "Linksys",
  "E8:9F:80": "Linksys",
  
  // Google / Nest
  "00:1A:11": "Google",
  "1C:F2:9A": "Google",
  "20:DF:B9": "Google",
  "24:7D:4D": "Google",
  "3C:5A:B4": "Google",
  "48:D6:D5": "Google",
  "54:60:09": "Google",
  "58:CB:52": "Google",
  "64:16:66": "Google",
  "6C:AD:F8": "Google",
  "70:3A:CB": "Google",
  "7C:61:66": "Google",
  "7C:D9:5C": "Google",
  "94:B8:6D": "Google",
  "94:EB:2C": "Google",
  "98:D2:93": "Google",
  "9C:A2:F4": "Google",
  "A4:77:33": "Google",
  "AC:BC:32": "Google",
  "B4:E6:2D": "Google",
  "C8:8B:3E": "Google",
  "CC:F4:11": "Google",
  "D4:38:9C": "Google",
  "D8:EB:46": "Google",
  "DA:A1:19": "Google",
  "E4:F0:42": "Google",
  "F0:EF:86": "Google",
  "F4:F5:D8": "Google",
  "F4:F5:E8": "Google",
  "F8:0F:F9": "Google",
  "F8:8F:CA": "Google",
  "FA:8F:CA": "Google",
  
  // Amazon / Echo
  "00:FC:8B": "Amazon",
  "0C:47:C9": "Amazon",
  "10:CE:A9": "Amazon",
  "14:91:82": "Amazon",
  "18:74:2E": "Amazon",
  "1C:12:B0": "Amazon",
  "24:4C:E3": "Amazon",
  "28:98:7B": "Amazon",
  "34:D2:70": "Amazon",
  "38:F7:3D": "Amazon",
  "40:A2:DB": "Amazon",
  "40:B4:CD": "Amazon",
  "44:65:0D": "Amazon",
  "48:4B:AA": "Amazon",
  "4C:EF:C0": "Amazon",
  "50:DC:E7": "Amazon",
  "50:F5:DA": "Amazon",
  "68:37:E9": "Amazon",
  "68:54:FD": "Amazon",
  "6C:56:97": "Amazon",
  "74:75:48": "Amazon",
  "74:C2:46": "Amazon",
  "78:E1:03": "Amazon",
  "84:D6:D0": "Amazon",
  "88:71:B1": "Amazon",
  "8C:26:A6": "Amazon",
  "94:85:3E": "Amazon",
  "98:9C:57": "Amazon",
  "A0:02:DC": "Amazon",
  "AC:63:BE": "Amazon",
  "B0:FC:36": "Amazon",
  "B4:7C:9C": "Amazon",
  "C8:84:A1": "Amazon",
  "D0:03:4B": "Amazon",
  "D8:6C:E9": "Amazon",
  "E0:F8:47": "Amazon",
  "F0:27:2D": "Amazon",
  "F0:81:73": "Amazon",
  "FC:65:DE": "Amazon",
  "FC:A1:83": "Amazon",
  
  // Sony / PlayStation
  "00:00:C3": "Sony",
  "00:01:4A": "Sony",
  "00:04:1F": "Sony",
  "00:09:B0": "Sony",
  "00:0A:D9": "Sony",
  "00:0B:0D": "Sony",
  "00:0E:07": "Sony",
  "00:0F:DE": "Sony",
  "00:12:EE": "Sony",
  "00:13:15": "Sony",
  "00:13:A9": "Sony",
  "00:15:C1": "Sony",
  "00:16:20": "Sony",
  "00:18:13": "Sony",
  "00:19:63": "Sony",
  "00:19:C5": "Sony",
  "00:1A:80": "Sony",
  "00:1B:59": "Sony",
  "00:1C:A4": "Sony",
  "00:1D:0D": "Sony",
  "00:1D:BA": "Sony",
  "00:1E:A4": "Sony",
  "00:1F:A7": "Sony",
  "00:21:9E": "Sony",
  "00:23:45": "Sony",
  "00:24:8D": "Sony",
  "00:24:BE": "Sony",
  "00:25:E7": "Sony",
  "00:26:43": "Sony",
  "04:5D:4B": "Sony",
  "08:A9:5A": "Sony",
  "0C:FE:45": "Sony",
  "10:59:32": "Sony",
  "28:0D:FC": "Sony",
  "2C:41:38": "Sony",
  "30:52:CB": "Sony",
  "30:A9:DE": "Sony",
  "40:B8:37": "Sony",
  
  // Nintendo
  "00:09:BF": "Nintendo",
  "00:17:AB": "Nintendo",
  "00:19:1D": "Nintendo",
  "00:19:FD": "Nintendo",
  "00:1A:E9": "Nintendo",
  "00:1B:7A": "Nintendo",
  "00:1B:EA": "Nintendo",
  "00:1C:BE": "Nintendo",
  "00:1D:BC": "Nintendo",
  "00:1E:35": "Nintendo",
  "00:1E:A9": "Nintendo",
  "00:1F:32": "Nintendo",
  "00:1F:C5": "Nintendo",
  "00:21:47": "Nintendo",
  "00:21:BD": "Nintendo",
  "00:22:4C": "Nintendo",
  "00:22:AA": "Nintendo",
  "00:23:31": "Nintendo",
  "00:23:CC": "Nintendo",
  "00:24:1E": "Nintendo",
  "00:24:F3": "Nintendo",
  "00:25:A0": "Nintendo",
  "00:26:59": "Nintendo",
  "00:27:09": "Nintendo",
  "04:03:D6": "Nintendo",
  "08:C0:21": "Nintendo",
  "10:1F:74": "Nintendo",
  "14:99:E2": "Nintendo",
  "2C:10:C1": "Nintendo",
  "34:AF:2C": "Nintendo",
  "40:D2:8A": "Nintendo",
  "40:F4:07": "Nintendo",
  "58:2F:40": "Nintendo",
  "58:BD:A3": "Nintendo",
  "5C:52:1E": "Nintendo",
  "60:6B:BD": "Nintendo",
  "64:B5:C6": "Nintendo",
  "78:A2:A0": "Nintendo",
  "7C:BB:8A": "Nintendo",
  "8C:56:C5": "Nintendo",
  "8C:CD:E8": "Nintendo",
  "98:41:5C": "Nintendo",
  "98:B6:E9": "Nintendo",
  "9C:E6:35": "Nintendo",
  "A4:38:CC": "Nintendo",
  "A4:C0:E1": "Nintendo",
  
  // Raspberry Pi
  "B8:27:EB": "Raspberry Pi",
  "DC:A6:32": "Raspberry Pi",
  "E4:5F:01": "Raspberry Pi",
  
  // VMware
  "00:0C:29": "VMware",
  "00:50:56": "VMware",
  "00:05:69": "VMware",
  
  // VirtualBox
  "08:00:27": "VirtualBox",
  
  // Ubiquiti
  "00:27:22": "Ubiquiti",
  "04:18:D6": "Ubiquiti",
  "18:E8:29": "Ubiquiti",
  "24:5A:4C": "Ubiquiti",
  "44:D9:E7": "Ubiquiti",
  "68:72:51": "Ubiquiti",
  "74:83:C2": "Ubiquiti",
  "78:8A:20": "Ubiquiti",
  "80:2A:A8": "Ubiquiti",
  "9C:05:D6": "Ubiquiti",
  "AC:8B:A9": "Ubiquiti",
  "B4:FB:E4": "Ubiquiti",
  "DC:9F:DB": "Ubiquiti",
  "E0:63:DA": "Ubiquiti",
  "F0:9F:C2": "Ubiquiti",
  "FC:EC:DA": "Ubiquiti",
};

/**
 * Normalize a MAC address to uppercase with colons
 */
export function normalizeMac(mac: string): string {
  const clean = mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (clean.length !== 12) return mac.toUpperCase();
  return clean.match(/.{2}/g)!.join(':');
}

/**
 * Extract the OUI (first 3 octets) from a MAC address
 */
export function extractOui(mac: string): string {
  const normalized = normalizeMac(mac);
  return normalized.substring(0, 8);
}

/**
 * Look up vendor from local database
 */
export function lookupVendorLocal(mac: string): string | null {
  const oui = extractOui(mac);
  return MAC_VENDORS[oui] || null;
}

/**
 * Look up vendor from online API (maclookup.app)
 */
export async function lookupVendorOnline(mac: string): Promise<string | null> {
  try {
    const cleanMac = mac.replace(/[^0-9a-fA-F]/g, '');
    const response = await fetch(
      `https://api.maclookup.app/v2/macs/${cleanMac}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data.success && data.company) {
      return data.company;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Look up vendor from macvendors.com API
 */
export async function lookupVendorMacVendors(mac: string): Promise<string | null> {
  try {
    const cleanMac = mac.replace(/[^0-9a-fA-F:.-]/g, '');
    const response = await fetch(
      `https://api.macvendors.com/${encodeURIComponent(cleanMac)}`,
      {
        method: 'GET',
      }
    );
    
    if (!response.ok) return null;
    
    const text = await response.text();
    return text.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Look up vendor trying local first, then online APIs
 */
export async function lookupVendor(mac: string): Promise<{
  vendor: string | null;
  source: 'local' | 'maclookup' | 'macvendors' | null;
}> {
  // Try local database first
  const localVendor = lookupVendorLocal(mac);
  if (localVendor) {
    return { vendor: localVendor, source: 'local' };
  }
  
  // Try maclookup.app API
  try {
    const onlineVendor = await lookupVendorOnline(mac);
    if (onlineVendor) {
      return { vendor: onlineVendor, source: 'maclookup' };
    }
  } catch {
    // Continue to next source
  }
  
  // Try macvendors.com API as fallback
  try {
    const macVendorsResult = await lookupVendorMacVendors(mac);
    if (macVendorsResult) {
      return { vendor: macVendorsResult, source: 'macvendors' };
    }
  } catch {
    // All sources failed
  }
  
  return { vendor: null, source: null };
}

/**
 * Batch lookup multiple MAC addresses
 */
export async function batchLookupVendors(
  macs: string[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  // Process in parallel with rate limiting
  const BATCH_SIZE = 5;
  for (let i = 0; i < macs.length; i += BATCH_SIZE) {
    const batch = macs.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (mac) => {
      const { vendor } = await lookupVendor(mac);
      return { mac: normalizeMac(mac), vendor };
    });
    
    const batchResults = await Promise.all(promises);
    for (const { mac, vendor } of batchResults) {
      results.set(mac, vendor);
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < macs.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  
  return results;
}
