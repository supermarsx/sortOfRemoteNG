use super::types::ToolkitRequest;
use serde_json::{json, Value};
use sha2::Digest;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

pub fn run(request: &ToolkitRequest) -> Result<Value, String> {
    match request.tool.as_str() {
        "hash" => hash(
            &request.target,
            request.option("algorithm").unwrap_or("SHA256"),
        ),
        "ipCalculator" => subnet(&request.target),
        _ => Err("Unknown local utility".into()),
    }
}

fn hash(text: &str, algorithm: &str) -> Result<Value, String> {
    let name = algorithm.to_ascii_uppercase().replace('-', "");
    let digest = match name.as_str() {
        "MD5" => format!("{:x}", md5::Md5::digest(text.as_bytes())),
        "SHA1" => format!("{:x}", sha1::Sha1::digest(text.as_bytes())),
        "SHA256" => format!("{:x}", sha2::Sha256::digest(text.as_bytes())),
        "SHA384" => format!("{:x}", sha2::Sha384::digest(text.as_bytes())),
        "SHA512" => format!("{:x}", sha2::Sha512::digest(text.as_bytes())),
        _ => return Err("Select MD5, SHA1, SHA256, SHA384 or SHA512".into()),
    };
    Ok(
        json!({"algorithm":name,"encoding":"UTF-8","bytes":text.len(),"digest":digest,
        "note":"Local calculation; input text is not included in this report. MD5 and SHA-1 are for legacy checksums, not security."}),
    )
}

fn subnet(value: &str) -> Result<Value, String> {
    let (address, prefix) = value
        .trim()
        .split_once('/')
        .ok_or("Enter an IPv4 or IPv6 address with a CIDR prefix, e.g. 192.168.1.10/24")?;
    let address = address
        .parse::<IpAddr>()
        .map_err(|_| "Invalid IP address")?;
    let prefix = prefix.parse::<u32>().map_err(|_| "Invalid CIDR prefix")?;
    match address {
        IpAddr::V4(ip) => {
            if prefix > 32 {
                return Err("IPv4 prefix must be between 0 and 32".into());
            }
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            let network = u32::from(ip) & mask;
            let broadcast = network | !mask;
            let total = 1_u64 << (32 - prefix);
            let usable = if prefix < 31 { total - 2 } else { total };
            Ok(json!({"version":4,"address":ip.to_string(),"prefix":prefix,
                "network":format!("{}/{}",Ipv4Addr::from(network),prefix),
                "netmask":Ipv4Addr::from(mask).to_string(),"wildcard":Ipv4Addr::from(!mask).to_string(),
                "broadcast":if prefix < 31 {Some(Ipv4Addr::from(broadcast).to_string())} else {None},
                "firstHost":Ipv4Addr::from(network + u32::from(prefix<31)).to_string(),
                "lastHost":Ipv4Addr::from(broadcast - u32::from(prefix<31)).to_string(),
                "totalAddresses":total.to_string(),"usableAddresses":usable.to_string(),
                "private":ip.is_private(),"loopback":ip.is_loopback(),"linkLocal":ip.is_link_local()}))
        }
        IpAddr::V6(ip) => {
            if prefix > 128 {
                return Err("IPv6 prefix must be between 0 and 128".into());
            }
            let mask = if prefix == 0 {
                0
            } else {
                u128::MAX << (128 - prefix)
            };
            let network = u128::from(ip) & mask;
            let total = if prefix == 0 {
                "340282366920938463463374607431768211456".into()
            } else {
                (1_u128 << (128 - prefix)).to_string()
            };
            Ok(json!({"version":6,"address":ip.to_string(),"prefix":prefix,
                "network":format!("{}/{}",Ipv6Addr::from(network),prefix),"netmask":Ipv6Addr::from(mask).to_string(),
                "firstAddress":Ipv6Addr::from(network).to_string(),"lastAddress":Ipv6Addr::from(network | !mask).to_string(),
                "totalAddresses":total,"loopback":ip.is_loopback(),"note":"IPv6 has no broadcast address. Counts describe the address range, not available host allocations."}))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_hashes_do_not_echo_inputs() {
        assert_eq!(
            hash("abc", "SHA256").unwrap()["digest"],
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hash("abc", "MD5").unwrap()["digest"],
            "900150983cd24fb0d6963f7d28e17f72"
        );
        assert!(hash("secret text", "SHA1").unwrap().get("input").is_none());
        assert_eq!(hash("é", "SHA-512").unwrap()["bytes"], 2);
        assert!(hash("abc", "unknown").is_err());
    }
    #[test]
    fn ipv4_boundary_networks() {
        assert_eq!(
            subnet("192.168.1.10/24").unwrap()["network"],
            "192.168.1.0/24"
        );
        assert_eq!(subnet("10.0.0.0/31").unwrap()["usableAddresses"], "2");
        assert_eq!(subnet("10.0.0.1/32").unwrap()["firstHost"], "10.0.0.1");
        assert_eq!(subnet("0.0.0.0/0").unwrap()["totalAddresses"], "4294967296");
    }
    #[test]
    fn ipv6_big_ranges_are_precise_strings() {
        assert_eq!(
            subnet("::/0").unwrap()["totalAddresses"],
            "340282366920938463463374607431768211456"
        );
        assert_eq!(
            subnet("2001:db8::1234/64").unwrap()["network"],
            "2001:db8::/64"
        );
        assert_eq!(subnet("::1/128").unwrap()["totalAddresses"], "1");
        for value in ["::/129", "1.2.3.4/33", "1.2.3.4/-1", "localhost/24"] {
            assert!(subnet(value).is_err());
        }
    }
}
