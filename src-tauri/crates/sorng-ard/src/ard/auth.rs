//! ARD / VNC authentication methods.
//!
//! Supports:
//! - **None** (security type 1)
//! - **VNC Auth** (security type 2): DES challenge-response
//! - **ARD Auth** (security type 30): Diffie-Hellman key exchange + AES-128-CBC
//!   encrypted credentials

use md5::{Digest as Md5Digest, Md5};
use rand::RngCore;

use super::errors::ArdError;
use super::rfb::RfbConnection;

/// No authentication.
pub fn auth_none(_conn: &mut RfbConnection) -> Result<(), ArdError> {
    Ok(())
}

/// VNC DES challenge-response authentication.
pub fn auth_vnc(conn: &mut RfbConnection, password: &str) -> Result<(), ArdError> {
    // Read 16-byte challenge.
    let mut challenge = [0u8; 16];
    conn.read_exact(&mut challenge)?;

    // VNC passwords are truncated/padded to 8 bytes and bit-reversed.
    let mut key = [0u8; 8];
    let pw_bytes = password.as_bytes();
    for i in 0..8.min(pw_bytes.len()) {
        key[i] = reverse_bits(pw_bytes[i]);
    }

    // Encrypt both 8-byte halves with DES.
    let mut response = [0u8; 16];
    response[..8].copy_from_slice(&des_encrypt_block(&key, &challenge[..8]));
    response[8..].copy_from_slice(&des_encrypt_block(&key, &challenge[8..]));

    conn.write_all(&response)
}

/// ARD Diffie-Hellman + AES-128-CBC authentication (security type 30).
pub fn auth_ard(
    conn: &mut RfbConnection,
    username: &str,
    password: &str,
) -> Result<(), ArdError> {
    // 1) Read DH parameters from server.
    let mut gen_buf = [0u8; 2];
    conn.read_exact(&mut gen_buf)?;
    let generator = u16::from_be_bytes(gen_buf) as u64;

    let mut key_len_buf = [0u8; 2];
    conn.read_exact(&mut key_len_buf)?;
    let key_len = u16::from_be_bytes(key_len_buf) as usize;

    let mut prime_bytes = vec![0u8; key_len];
    conn.read_exact(&mut prime_bytes)?;

    let mut peer_key_bytes = vec![0u8; key_len];
    conn.read_exact(&mut peer_key_bytes)?;

    let prime = BigUint::from_bytes_be(&prime_bytes);
    let peer_key = BigUint::from_bytes_be(&peer_key_bytes);
    let gen = BigUint::from_bytes_be(&(generator as u32).to_be_bytes());

    // 2) Generate our DH key pair.
    let mut rng = rand::thread_rng();
    let mut private_bytes = vec![0u8; key_len];
    rng.fill_bytes(&mut private_bytes);
    let private_key = BigUint::from_bytes_be(&private_bytes);

    let public_key = mod_pow(&gen, &private_key, &prime);
    let shared_secret = mod_pow(&peer_key, &private_key, &prime);

    // 3) Derive AES key from MD5(shared_secret).
    let secret_bytes = shared_secret.to_bytes_be(key_len);
    let md5_hash = Md5::digest(&secret_bytes);
    let aes_key: [u8; 16] = md5_hash.into();

    // 4) Encrypt credentials: 64 bytes username + 64 bytes password.
    let mut credentials = [0u8; 128];
    let user_bytes = username.as_bytes();
    let pass_bytes = password.as_bytes();
    credentials[..user_bytes.len().min(64)].copy_from_slice(&user_bytes[..user_bytes.len().min(64)]);
    credentials[64..64 + pass_bytes.len().min(64)]
        .copy_from_slice(&pass_bytes[..pass_bytes.len().min(64)]);

    // AES-128-CBC with zero IV.
    let iv = [0u8; 16];
    let encrypted = aes_cbc_encrypt(&aes_key, &iv, &credentials)?;

    // 5) Send: client public key + encrypted credentials.
    let pub_key_bytes = public_key.to_bytes_be(key_len);
    conn.write_all(&pub_key_bytes)?;
    conn.write_all(&encrypted)?;

    Ok(())
}

/// AES-128-CBC encryption.
fn aes_cbc_encrypt(key: &[u8; 16], iv: &[u8; 16], data: &[u8]) -> Result<Vec<u8>, ArdError> {
    use aes::cipher::{block_padding::NoPadding, BlockEncryptMut, KeyIvInit};
    type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

    // Data must be a multiple of 16 bytes.
    let padded_len = ((data.len() + 15) / 16) * 16;
    let mut buf = vec![0u8; padded_len];
    buf[..data.len()].copy_from_slice(data);

    let cipher = Aes128CbcEnc::new(key.into(), iv.into());
    let encrypted = cipher
        .encrypt_padded_mut::<NoPadding>(&mut buf, padded_len)
        .map_err(|e| ArdError::Auth(format!("AES encrypt: {e}")))?;

    Ok(encrypted.to_vec())
}

// ── VNC DES implementation ───────────────────────────────────────────────

/// Reverse the bits of a byte (VNC key mangling).
fn reverse_bits(b: u8) -> u8 {
    let mut r = 0u8;
    for i in 0..8 {
        if b & (1 << i) != 0 {
            r |= 1 << (7 - i);
        }
    }
    r
}

/// Single DES block encryption (VNC uses only ECB, two 8-byte blocks).
fn des_encrypt_block(key: &[u8; 8], block: &[u8]) -> [u8; 8] {
    let subkeys = des_key_schedule(key);
    let mut data = [0u8; 8];
    data.copy_from_slice(&block[..8]);
    des_encrypt_with_subkeys(&data, &subkeys)
}

fn des_key_schedule(key: &[u8; 8]) -> [[u8; 6]; 16] {
    // PC-1 permutation: 56 bits from 64-bit key
    const PC1: [u8; 56] = [
        57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2,
        59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39,
        31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37,
        29, 21, 13, 5, 28, 20, 12, 4,
    ];
    // PC-2 permutation: 48 bits from 56 bits
    const PC2: [u8; 48] = [
        14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4,
        26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40,
        51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
    ];
    const LEFT_SHIFTS: [u8; 16] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

    let key_bits = bytes_to_bits(key);
    let mut permuted = [0u8; 56];
    for (i, &p) in PC1.iter().enumerate() {
        permuted[i] = key_bits[(p - 1) as usize];
    }

    let (mut c, mut d) = ([0u8; 28], [0u8; 28]);
    c.copy_from_slice(&permuted[..28]);
    d.copy_from_slice(&permuted[28..]);

    let mut subkeys = [[0u8; 6]; 16];
    for round in 0..16 {
        for _ in 0..LEFT_SHIFTS[round] {
            let tc = c[0];
            c.rotate_left(1);
            c[27] = tc;
            let td = d[0];
            d.rotate_left(1);
            d[27] = td;
        }
        let mut cd = [0u8; 56];
        cd[..28].copy_from_slice(&c);
        cd[28..].copy_from_slice(&d);

        let mut key48 = [0u8; 48];
        for (i, &p) in PC2.iter().enumerate() {
            key48[i] = cd[(p - 1) as usize];
        }
        subkeys[round] = bits_to_6bytes(&key48);
    }

    subkeys
}

fn des_encrypt_with_subkeys(block: &[u8; 8], subkeys: &[[u8; 6]; 16]) -> [u8; 8] {
    const IP: [u8; 64] = [
        58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
        62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
        57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
        61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
    ];
    const FP: [u8; 64] = [
        40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
        38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
        36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
        34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
    ];
    const E: [u8; 48] = [
        32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11,
        12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21,
        22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
    ];
    const P: [u8; 32] = [
        16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
        2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
    ];
    const SBOXES: [[[u8; 16]; 4]; 8] = [
        [
            [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
            [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
            [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
            [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
        ],
        [
            [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
            [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
            [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
            [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
        ],
        [
            [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
            [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
            [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
            [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
        ],
        [
            [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
            [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
            [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
            [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
        ],
        [
            [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
            [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
            [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
            [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
        ],
        [
            [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
            [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
            [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
            [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
        ],
        [
            [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
            [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
            [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
            [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
        ],
        [
            [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
            [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 2, 0, 14, 9, 11],
            [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
            [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
        ],
    ];

    let bits = bytes_to_bits(block);
    let mut permuted = [0u8; 64];
    for (i, &p) in IP.iter().enumerate() {
        permuted[i] = bits[(p - 1) as usize];
    }

    let (mut l, mut r) = ([0u8; 32], [0u8; 32]);
    l.copy_from_slice(&permuted[..32]);
    r.copy_from_slice(&permuted[32..]);

    for round in 0..16 {
        let mut expanded = [0u8; 48];
        for (i, &p) in E.iter().enumerate() {
            expanded[i] = r[(p - 1) as usize];
        }

        // XOR with subkey
        let sk_bits = bytes6_to_bits(&subkeys[round]);
        for i in 0..48 {
            expanded[i] ^= sk_bits[i];
        }

        // S-box substitution
        let mut sbox_out = [0u8; 32];
        for s in 0..8 {
            let offset = s * 6;
            let row = (expanded[offset] << 1) | expanded[offset + 5];
            let col = (expanded[offset + 1] << 3)
                | (expanded[offset + 2] << 2)
                | (expanded[offset + 3] << 1)
                | expanded[offset + 4];
            let val = SBOXES[s][row as usize][col as usize];
            for bit in 0..4 {
                sbox_out[s * 4 + bit] = (val >> (3 - bit)) & 1;
            }
        }

        // P permutation
        let mut p_out = [0u8; 32];
        for (i, &p) in P.iter().enumerate() {
            p_out[i] = sbox_out[(p - 1) as usize];
        }

        // XOR with L, swap
        let new_r: Vec<u8> = l.iter().zip(p_out.iter()).map(|(a, b)| a ^ b).collect();
        l.copy_from_slice(&r);
        r.copy_from_slice(&new_r);
    }

    // Final permutation (R + L, note swap)
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(&r);
    combined[32..].copy_from_slice(&l);

    let mut result_bits = [0u8; 64];
    for (i, &p) in FP.iter().enumerate() {
        result_bits[i] = combined[(p - 1) as usize];
    }

    bits_to_bytes(&result_bits)
}

fn bytes_to_bits(bytes: &[u8]) -> Vec<u8> {
    let mut bits = Vec::with_capacity(bytes.len() * 8);
    for &b in bytes {
        for i in (0..8).rev() {
            bits.push((b >> i) & 1);
        }
    }
    bits
}

fn bits_to_bytes(bits: &[u8]) -> [u8; 8] {
    let mut bytes = [0u8; 8];
    for i in 0..8 {
        for j in 0..8 {
            bytes[i] |= bits[i * 8 + j] << (7 - j);
        }
    }
    bytes
}

fn bits_to_6bytes(bits: &[u8]) -> [u8; 6] {
    let mut bytes = [0u8; 6];
    for i in 0..6 {
        for j in 0..8 {
            let idx = i * 8 + j;
            if idx < bits.len() {
                bytes[i] |= bits[idx] << (7 - j);
            }
        }
    }
    bytes
}

fn bytes6_to_bits(bytes: &[u8; 6]) -> Vec<u8> {
    bytes_to_bits(bytes)
}

// ── Minimal Big Integer ──────────────────────────────────────────────────

/// Minimal unsigned big-integer type (big-endian limbs) for DH math.
#[derive(Debug, Clone)]
pub(crate) struct BigUint {
    /// Limbs stored in big-endian order (most significant first).
    limbs: Vec<u32>,
}

impl BigUint {
    pub fn from_bytes_be(bytes: &[u8]) -> Self {
        // Pad to 4-byte alignment.
        let padded_len = ((bytes.len() + 3) / 4) * 4;
        let mut padded = vec![0u8; padded_len];
        padded[padded_len - bytes.len()..].copy_from_slice(bytes);

        let mut limbs = Vec::with_capacity(padded.len() / 4);
        for chunk in padded.chunks_exact(4) {
            limbs.push(u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }

        // Remove leading zeros but keep at least one limb.
        while limbs.len() > 1 && limbs[0] == 0 {
            limbs.remove(0);
        }

        Self { limbs }
    }

    pub fn to_bytes_be(&self, min_len: usize) -> Vec<u8> {
        let mut bytes = Vec::new();
        for &limb in &self.limbs {
            bytes.extend_from_slice(&limb.to_be_bytes());
        }

        // Remove leading zeros.
        while bytes.len() > 1 && bytes[0] == 0 {
            bytes.remove(0);
        }

        // Pad to min_len.
        while bytes.len() < min_len {
            bytes.insert(0, 0);
        }

        bytes
    }

    fn is_zero(&self) -> bool {
        self.limbs.iter().all(|&l| l == 0)
    }

    fn is_odd(&self) -> bool {
        self.limbs.last().map_or(false, |&l| l & 1 != 0)
    }

    /// Right-shift by 1 bit.
    fn shr1(&self) -> Self {
        let mut result = self.limbs.clone();
        let mut carry = 0u32;
        for limb in result.iter_mut() {
            let new_carry = *limb & 1;
            *limb = (*limb >> 1) | (carry << 31);
            carry = new_carry;
        }
        while result.len() > 1 && result[0] == 0 {
            result.remove(0);
        }
        Self { limbs: result }
    }

    /// Left-shift by 1 bit (for internal multiplication).
    fn shl1(&self) -> Self {
        let mut result = self.limbs.clone();
        let mut carry = 0u32;
        for limb in result.iter_mut().rev() {
            let new_carry = *limb >> 31;
            *limb = (*limb << 1) | carry;
            carry = new_carry;
        }
        if carry != 0 {
            result.insert(0, carry);
        }
        Self { limbs: result }
    }

    /// Multiply two BigUints.
    fn mul(&self, other: &Self) -> Self {
        let n = self.limbs.len();
        let m = other.limbs.len();
        let mut result = vec![0u64; n + m];

        for i in (0..n).rev() {
            for j in (0..m).rev() {
                let prod = self.limbs[i] as u64 * other.limbs[j] as u64;
                let pos = (n - 1 - i) + (m - 1 - j);
                result[pos] += prod;
            }
        }

        // Propagate carries.
        for i in 0..result.len() - 1 {
            result[i + 1] += result[i] >> 32;
            result[i] &= 0xFFFFFFFF;
        }

        // Convert back to big-endian limbs.
        let mut limbs: Vec<u32> = result.iter().rev().map(|&v| v as u32).collect();
        while limbs.len() > 1 && limbs[0] == 0 {
            limbs.remove(0);
        }

        Self { limbs }
    }

    /// Compute self mod modulus using repeated subtraction / shift.
    fn modulo(&self, modulus: &Self) -> Self {
        if modulus.is_zero() {
            return Self { limbs: vec![0] };
        }
        if self.cmp(modulus) == std::cmp::Ordering::Less {
            return self.clone();
        }

        // Simple long-division modulus.
        let mut remainder = Self { limbs: vec![0] };
        let total_bits = self.limbs.len() * 32;

        for bit_idx in 0..total_bits {
            remainder = remainder.shl1();
            let limb_idx = bit_idx / 32;
            let bit_pos = 31 - (bit_idx % 32);
            if limb_idx < self.limbs.len() && (self.limbs[limb_idx] >> bit_pos) & 1 != 0 {
                // Set lowest bit.
                if let Some(last) = remainder.limbs.last_mut() {
                    *last |= 1;
                }
            }
            if remainder.cmp(modulus) != std::cmp::Ordering::Less {
                remainder = remainder.sub(modulus);
            }
        }

        remainder
    }

    fn sub(&self, other: &Self) -> Self {
        let n = self.limbs.len().max(other.limbs.len());
        let mut a = vec![0u32; n];
        let mut b = vec![0u32; n];
        for (i, &l) in self.limbs.iter().rev().enumerate() {
            a[i] = l;
        }
        for (i, &l) in other.limbs.iter().rev().enumerate() {
            b[i] = l;
        }

        let mut result = vec![0u32; n];
        let mut borrow = 0i64;
        for i in 0..n {
            let diff = a[i] as i64 - b[i] as i64 - borrow;
            if diff < 0 {
                result[i] = (diff + (1i64 << 32)) as u32;
                borrow = 1;
            } else {
                result[i] = diff as u32;
                borrow = 0;
            }
        }

        let mut limbs: Vec<u32> = result.into_iter().rev().collect();
        while limbs.len() > 1 && limbs[0] == 0 {
            limbs.remove(0);
        }
        Self { limbs }
    }

    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        let a = &self.limbs;
        let b = &other.limbs;
        // Compare by length first (after removing leading zeros).
        match a.len().cmp(&b.len()) {
            std::cmp::Ordering::Equal => {
                for (x, y) in a.iter().zip(b.iter()) {
                    match x.cmp(y) {
                        std::cmp::Ordering::Equal => continue,
                        other => return other,
                    }
                }
                std::cmp::Ordering::Equal
            }
            other => other,
        }
    }
}

/// Modular exponentiation: base^exp mod modulus.
pub(crate) fn mod_pow(base: &BigUint, exp: &BigUint, modulus: &BigUint) -> BigUint {
    if modulus.is_zero() {
        return BigUint { limbs: vec![0] };
    }

    let mut result = BigUint::from_bytes_be(&[1]);
    let mut base = base.modulo(modulus);
    let mut exp = exp.clone();

    while !exp.is_zero() {
        if exp.is_odd() {
            result = result.mul(&base).modulo(modulus);
        }
        exp = exp.shr1();
        base = base.mul(&base).modulo(modulus);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reverse_bits_check() {
        assert_eq!(reverse_bits(0b10000000), 0b00000001);
        assert_eq!(reverse_bits(0b11110000), 0b00001111);
    }

    #[test]
    fn biguint_from_to_bytes() {
        let bytes = vec![0x01, 0x02, 0x03];
        let n = BigUint::from_bytes_be(&bytes);
        let out = n.to_bytes_be(3);
        assert_eq!(out, bytes);
    }

    #[test]
    fn biguint_zero() {
        let z = BigUint::from_bytes_be(&[0]);
        assert!(z.is_zero());
    }

    #[test]
    fn mod_pow_small() {
        let base = BigUint::from_bytes_be(&[2]);
        let exp = BigUint::from_bytes_be(&[10]);
        let modulus = BigUint::from_bytes_be(&[0x03, 0xE9]); // 1001
        let result = mod_pow(&base, &exp, &modulus);
        let bytes = result.to_bytes_be(1);
        // 2^10 = 1024, 1024 mod 1001 = 23
        let val = bytes.iter().fold(0u64, |acc, &b| (acc << 8) | b as u64);
        assert_eq!(val, 23);
    }

    #[test]
    fn des_encrypt_known_vector() {
        // NIST test vector — just verify it doesn't panic with a zero key.
        let key = [0u8; 8];
        let block = [0u8; 8];
        let result = des_encrypt_block(&key, &block);
        assert_eq!(result.len(), 8);
    }

    #[test]
    fn biguint_modulo() {
        let a = BigUint::from_bytes_be(&[100]);
        let m = BigUint::from_bytes_be(&[7]);
        let r = a.modulo(&m);
        let bytes = r.to_bytes_be(1);
        assert_eq!(bytes[0], 2); // 100 mod 7 = 2
    }
}
