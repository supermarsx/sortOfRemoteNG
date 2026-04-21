use crate::types::LicenseEntry;

static MIT_TEXT: &str = include_str!("../licenses/MIT.txt");
static APACHE2_TEXT: &str = include_str!("../licenses/Apache-2.0.txt");
static BSD2_TEXT: &str = include_str!("../licenses/BSD-2-Clause.txt");
static BSD3_TEXT: &str = include_str!("../licenses/BSD-3-Clause.txt");
static ISC_TEXT: &str = include_str!("../licenses/ISC.txt");

pub fn get_all_license_texts() -> Vec<LicenseEntry> {
    vec![
        LicenseEntry {
            identifier: "MIT".to_string(),
            name: "MIT License".to_string(),
            text: MIT_TEXT.to_string(),
            url: "https://opensource.org/licenses/MIT".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "Apache-2.0".to_string(),
            name: "Apache License 2.0".to_string(),
            text: APACHE2_TEXT.to_string(),
            url: "https://opensource.org/licenses/Apache-2.0".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "BSD-2-Clause".to_string(),
            name: "BSD 2-Clause \"Simplified\" License".to_string(),
            text: BSD2_TEXT.to_string(),
            url: "https://opensource.org/licenses/BSD-2-Clause".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "BSD-3-Clause".to_string(),
            name: "BSD 3-Clause \"New\" or \"Revised\" License".to_string(),
            text: BSD3_TEXT.to_string(),
            url: "https://opensource.org/licenses/BSD-3-Clause".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "ISC".to_string(),
            name: "ISC License".to_string(),
            text: ISC_TEXT.to_string(),
            url: "https://opensource.org/licenses/ISC".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "MPL-2.0".to_string(),
            name: "Mozilla Public License 2.0".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/MPL-2.0".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "Zlib".to_string(),
            name: "zlib License".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/Zlib".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "BSL-1.0".to_string(),
            name: "Boost Software License 1.0".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/BSL-1.0".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "CC0-1.0".to_string(),
            name: "Creative Commons Zero v1.0 Universal".to_string(),
            text: String::new(),
            url: "https://creativecommons.org/publicdomain/zero/1.0/".to_string(),
            osi_approved: false,
        },
        LicenseEntry {
            identifier: "Unlicense".to_string(),
            name: "The Unlicense".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/Unlicense".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "0BSD".to_string(),
            name: "BSD Zero Clause License".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/0BSD".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "MIT-0".to_string(),
            name: "MIT No Attribution".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/MIT-0".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "Unicode-3.0".to_string(),
            name: "Unicode License v3".to_string(),
            text: String::new(),
            url: "https://www.unicode.org/license.txt".to_string(),
            osi_approved: false,
        },
        LicenseEntry {
            identifier: "OpenSSL".to_string(),
            name: "OpenSSL License".to_string(),
            text: String::new(),
            url: "https://www.openssl.org/source/license.html".to_string(),
            osi_approved: false,
        },
        LicenseEntry {
            identifier: "LGPL-2.1-or-later".to_string(),
            name: "GNU Lesser General Public License v2.1 or later".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/LGPL-2.1".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "GPL-3.0".to_string(),
            name: "GNU General Public License v3.0".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/GPL-3.0".to_string(),
            osi_approved: true,
        },
        LicenseEntry {
            identifier: "CDLA-Permissive-2.0".to_string(),
            name: "Community Data License Agreement Permissive 2.0".to_string(),
            text: String::new(),
            url: "https://cdla.dev/permissive-2-0/".to_string(),
            osi_approved: false,
        },
        LicenseEntry {
            identifier: "BSD-1-Clause".to_string(),
            name: "BSD 1-Clause License".to_string(),
            text: String::new(),
            url: "https://opensource.org/licenses/BSD-1-Clause".to_string(),
            osi_approved: true,
        },
    ]
}

pub fn get_license_text(identifier: &str) -> Option<LicenseEntry> {
    get_all_license_texts()
        .into_iter()
        .find(|l| l.identifier.eq_ignore_ascii_case(identifier))
}
