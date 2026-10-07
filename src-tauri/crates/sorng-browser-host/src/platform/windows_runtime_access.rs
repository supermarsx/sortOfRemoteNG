//! Bounded, browser-only CEF code/resource ACL repair. Not a sandbox attestation.
//! Keep this allowlist aligned with the packaging-side runtime ACL preflight.
//! Never walk descendants recursively, modify ancestors, or grant inheritance.
use super::bootstrap::BootstrapError;
use std::{
    ffi::{c_void, OsString},
    fs,
    mem::{size_of, zeroed},
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Component, Path, PathBuf, Prefix},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, LocalFree, RtlNtStatusToDosError, HANDLE, INVALID_HANDLE_VALUE,
        LUID,
    },
    Security::{
        AddAce, Authorization::*, GetAce, GetSecurityDescriptorControl, InitializeAcl,
        InitializeSecurityDescriptor, IsValidAcl, MapGenericMask, SetSecurityDescriptorControl,
        SetSecurityDescriptorDacl, SetSecurityDescriptorGroup, SetSecurityDescriptorOwner,
        ACE_HEADER, ACL, ACL_REVISION, DACL_SECURITY_INFORMATION, GENERIC_MAPPING,
        GROUP_SECURITY_INFORMATION, INHERITED_ACE, INHERIT_ONLY_ACE, OWNER_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR, PSID, SECURITY_DESCRIPTOR, SE_DACL_AUTO_INHERITED,
        SE_DACL_AUTO_INHERIT_REQ, SE_DACL_DEFAULTED, SE_DACL_PROTECTED,
    },
    Storage::FileSystem::*,
    System::LibraryLoader::{GetModuleFileNameW, GetModuleHandleW},
};

const RX: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
const REPAIR_ACCESS: u32 = READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES;
// The user-mode entry point documented by ZwSetSecurityObject. Unlike the
// high-level SetSecurityInfo tree propagation, this updates one pinned object.
// https://learn.microsoft.com/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwsetsecurityobject
#[link(name = "ntdll")]
extern "system" {
    fn NtSetSecurityObject(
        handle: HANDLE,
        information: u32,
        descriptor: PSECURITY_DESCRIPTOR,
    ) -> i32;
}
const MAX_TARGETS: usize = 512;
const FILES: &[&str] = &[
    "libcef.dll",
    "chrome_elf.dll",
    "libEGL.dll",
    "libGLESv2.dll",
    "d3dcompiler_47.dll",
    "dxcompiler.dll",
    "dxil.dll",
    "vk_swiftshader.dll",
    "vulkan-1.dll",
    "icudtl.dat",
    "v8_context_snapshot.bin",
    "snapshot_blob.bin",
    "resources.pak",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "vk_swiftshader_icd.json",
];
const UNSAFE_PATH: &str = "CEF sandbox bundle access rejected: use a local, canonical bundle without junctions, symlinks or hard-linked runtime files. Reinstall/re-stage the bundle; do not disable the sandbox.";
const ACL_UNAVAILABLE: &str = "CEF sandbox cannot read or repair its bundle ACLs. Reinstall/re-stage in a writable local application directory, or have the installer grant both application-package SIDs read/execute on the exact runtime files only. No elevation or sandbox bypass was attempted.";
const DENY: &str = "CEF sandbox read/execute is blocked by an existing deny or unsupported conditional/object ACE. Existing policy was preserved; review that policy or reinstall in an approved local directory. Do not disable the sandbox.";
const CHANGED: &str = "CEF sandbox bundle identity or ACL changed during startup. Close the updater and retry from a freshly verified bundle; no broader permissions were granted.";
type Result<T> = std::result::Result<T, BootstrapError>;

fn error(message: &'static str) -> BootstrapError {
    BootstrapError::PlatformPrecondition(message)
}

fn win_error(path: &Path, action: &'static str, code: u32) -> BootstrapError {
    eprintln!(
        "CEF runtime ACL {action}: {} (Win32 0x{code:08x})",
        path.display()
    );
    error(ACL_UNAVAILABLE)
}

fn wide(path: &Path) -> Result<Vec<u16>> {
    let mut value: Vec<u16> = path.as_os_str().encode_wide().collect();
    if value.contains(&0) {
        return Err(error(UNSAFE_PATH));
    }
    value.push(0);
    Ok(value)
}

fn path_key(path: &Path) -> Result<String> {
    let text = path.to_str().ok_or_else(|| error(UNSAFE_PATH))?;
    let text = text.strip_prefix(r"\\?\").unwrap_or(text);
    if text.starts_with(r"\") || text.contains('/') {
        return Err(error(UNSAFE_PATH));
    }
    Ok(text.to_ascii_lowercase())
}

fn local_absolute(path: &Path) -> bool {
    let mut parts = path.components();
    matches!(parts.next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
        && matches!(parts.next(), Some(Component::RootDir))
        && parts.all(|p| matches!(p, Component::Normal(_)))
}

fn locale_name(name: &str) -> bool {
    name.strip_suffix(".pak").is_some_and(|stem| {
        !stem.is_empty()
            && stem
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

struct PinnedFile {
    handle: Handle,
    path: PathBuf,
    info: BY_HANDLE_FILE_INFORMATION,
}

impl PinnedFile {
    fn open(path: &Path, directory: bool, access: u32) -> Result<Self> {
        let name = wide(path)?;
        let raw = unsafe {
            CreateFileW(
                name.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
                null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(win_error(path, "open", unsafe { GetLastError() }));
        }
        let handle = Handle(raw);
        let mut info = unsafe { zeroed::<BY_HANDLE_FILE_INFORMATION>() };
        if unsafe { GetFileInformationByHandle(raw, &mut info) } == 0 {
            return Err(win_error(path, "identity", unsafe { GetLastError() }));
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
            || (!directory && info.nNumberOfLinks != 1)
        {
            return Err(error(UNSAFE_PATH));
        }
        let mut buffer = vec![0u16; 32768];
        let count =
            unsafe { GetFinalPathNameByHandleW(raw, buffer.as_mut_ptr(), buffer.len() as u32, 0) }
                as usize;
        if count == 0 || count >= buffer.len() {
            return Err(error(UNSAFE_PATH));
        }
        let canonical = PathBuf::from(OsString::from_wide(&buffer[..count]));
        if path_key(&canonical)? != path_key(path)? {
            return Err(error(UNSAFE_PATH));
        }
        Ok(Self {
            handle,
            path: canonical,
            info,
        })
    }

    fn same_file(&self, other: &Self) -> bool {
        self.info.dwVolumeSerialNumber == other.info.dwVolumeSerialNumber
            && self.info.nFileIndexHigh == other.info.nFileIndexHigh
            && self.info.nFileIndexLow == other.info.nFileIndexLow
    }

    fn recheck(&self) -> Result<()> {
        let mut info = unsafe { zeroed::<BY_HANDLE_FILE_INFORMATION>() };
        if unsafe { GetFileInformationByHandle(self.handle.0, &mut info) } == 0 {
            return Err(win_error(&self.path, "recheck identity", unsafe {
                GetLastError()
            }));
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0 && info.nNumberOfLinks != 1)
            || info.dwVolumeSerialNumber != self.info.dwVolumeSerialNumber
            || info.nFileIndexHigh != self.info.nFileIndexHigh
            || info.nFileIndexLow != self.info.nFileIndexLow
        {
            return Err(error(CHANGED));
        }
        Ok(())
    }
}

// Holding no-delete-share handles prevents replacing a selected file or parent
// during preflight/repair/cef_initialize. Ancestor handles are read-only.
pub(super) struct RuntimeAccessGuard {
    _pins: Vec<PinnedFile>,
}

pub(super) fn prepare(settings: &cef::Settings) -> Result<RuntimeAccessGuard> {
    let executable = std::env::current_exe().map_err(|_| error(UNSAFE_PATH))?;
    if !local_absolute(&executable) {
        return Err(error(UNSAFE_PATH));
    }
    let root = executable
        .parent()
        .ok_or_else(|| error(UNSAFE_PATH))?
        .to_owned();
    if root.parent().is_none() {
        return Err(error(UNSAFE_PATH));
    }
    let stem = executable
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| error(UNSAFE_PATH))?;
    if !executable
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("exe"))
    {
        return Err(error(UNSAFE_PATH));
    }
    let mut pins = Vec::new();
    // Walk only this absolute ancestor chain, not its contents. Resolve each
    // directory without following its final reparse entry, then pin it.
    let mut ancestors: Vec<_> = root.ancestors().collect();
    ancestors.reverse();
    for directory in ancestors {
        pins.push(PinnedFile::open(directory, true, FILE_READ_ATTRIBUTES)?);
    }
    if path_key(&PathBuf::from(settings.resources_dir_path.to_string()))? != path_key(&root)? {
        return Err(error(UNSAFE_PATH));
    }
    let client = root.join(format!("{stem}.dll"));
    for module in [&client, &root.join("libcef.dll")] {
        verify_loaded_module(module)?;
    }
    let mut targets = vec![
        (root.to_owned(), true),
        (executable, false),
        (client, false),
    ];
    for name in FILES {
        let path = root.join(name);
        match fs::symlink_metadata(&path) {
            Ok(_) => targets.push((path, false)),
            Err(e)
                if e.kind() == std::io::ErrorKind::NotFound
                    && !matches!(*name, "libcef.dll" | "icudtl.dat" | "resources.pak") => {}
            Err(_) => return Err(error(UNSAFE_PATH)),
        }
    }
    let locales = root.join("locales");
    let locale_pin = PinnedFile::open(&locales, true, FILE_READ_ATTRIBUTES)?;
    targets.push((locales.clone(), true));
    pins.push(locale_pin);
    let entries = fs::read_dir(&locales).map_err(|_| error(UNSAFE_PATH))?;
    for (index, entry) in entries.enumerate() {
        if index >= MAX_TARGETS {
            return Err(error(UNSAFE_PATH));
        }
        let entry = entry.map_err(|_| error(UNSAFE_PATH))?;
        if entry.file_name().to_str().is_some_and(locale_name) {
            targets.push((entry.path(), false));
        }
    }
    if targets.len() > MAX_TARGETS {
        return Err(error(UNSAFE_PATH));
    }
    // Validate the complete candidate set before changing any ACL.
    let mut selected = Vec::new();
    for (path, directory) in targets {
        selected.push(PinnedFile::open(
            &path,
            directory,
            READ_CONTROL | FILE_READ_ATTRIBUTES,
        )?);
    }
    let access = PackageAccess::new()?;
    let mut repairs = Vec::new();
    for target in &selected {
        let security = Security::read(target)?;
        let aces = security.aces()?;
        // Never treat package-specific allows as overriding an existing RX
        // deny (including Everyone or an unmodelled normal-token group).
        validate_repair(&aces)?;
        let missing = access.missing(&security, &aces)?;
        if missing.iter().any(|value| *value) {
            // No MAXIMUM_ALLOWED: its implicit DELETE access conflicts with
            // our no-delete-share pins (and an application's current directory).
            let directory = target.info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
            let writable = PinnedFile::open(&target.path, directory, REPAIR_ACCESS)?;
            if !target.same_file(&writable) {
                return Err(error(CHANGED));
            }
            let proposed = appended_aces(&aces, missing);
            repairs.push((writable, security, aces, proposed));
        }
    }
    for (target, before, aces, proposed) in repairs {
        target.recheck()?;
        let current = Security::read(&target)?;
        if current.aces()? != aces || current.control()? != before.control()? {
            return Err(error(CHANGED));
        }
        let acl = Acl::from_aces(&proposed, false)?;
        write_dacl(&target, &acl, before.control()?)?;
        target.recheck()?;
        let after = Security::read(&target)?;
        if after.aces()? != proposed
            || after.control()? != before.control()?
            || access
                .missing(&after, &proposed)?
                .iter()
                .any(|value| *value)
        {
            return Err(error(CHANGED));
        }
        pins.push(target);
    }
    // Recheck even the no-op entries immediately before CEF can spawn children.
    for target in &selected {
        target.recheck()?;
        let security = Security::read(target)?;
        let aces = security.aces()?;
        validate_repair(&aces)?;
        if access
            .missing(&security, &aces)?
            .iter()
            .any(|missing| *missing)
        {
            return Err(error(CHANGED));
        }
    }
    pins.extend(selected);
    Ok(RuntimeAccessGuard { _pins: pins })
}

fn dacl_write_control(control: u16) -> Result<u16> {
    if control & SE_DACL_AUTO_INHERIT_REQ != 0 {
        return Err(error(DENY));
    }
    let preserved = control & (SE_DACL_PROTECTED | SE_DACL_AUTO_INHERITED);
    // NtSetSecurityObject requires the request bit on its temporary input to
    // retain an EXISTING AUTO_INHERITED bit. Without it, Windows clears that
    // persisted bit (0x8404 -> 0x8004). The request bit itself is not persisted.
    // This single-object call does not perform SetSecurityInfo's tree walk.
    Ok(preserved
        | if preserved & SE_DACL_AUTO_INHERITED != 0 {
            SE_DACL_AUTO_INHERIT_REQ
        } else {
            0
        })
}

fn write_dacl(target: &PinnedFile, acl: &Acl, control: u16) -> Result<()> {
    // Preserve protection/default/inheritance state, all original ACE bytes,
    // and strict readback equality; never update any descendant descriptor.
    let write_control = dacl_write_control(control)?;
    let mut sd = unsafe { zeroed::<SECURITY_DESCRIPTOR>() };
    let descriptor = (&mut sd as *mut SECURITY_DESCRIPTOR).cast::<c_void>();
    let control_mask = SE_DACL_PROTECTED | SE_DACL_AUTO_INHERITED | SE_DACL_AUTO_INHERIT_REQ;
    if unsafe { InitializeSecurityDescriptor(descriptor, 1) } == 0
        || unsafe {
            SetSecurityDescriptorDacl(
                descriptor,
                1,
                acl.ptr(),
                (control & SE_DACL_DEFAULTED != 0) as i32,
            )
        } == 0
        || unsafe { SetSecurityDescriptorControl(descriptor, control_mask, write_control) } == 0
    {
        return Err(error(ACL_UNAVAILABLE));
    }
    // Only DACL_SECURITY_INFORMATION: never owner, group, SACL, elevation or a
    // protection toggle. The handle remains identity-pinned without DELETE.
    let status =
        unsafe { NtSetSecurityObject(target.handle.0, DACL_SECURITY_INFORMATION, descriptor) };
    if status < 0 {
        return Err(win_error(&target.path, "write pinned DACL", unsafe {
            RtlNtStatusToDosError(status)
        }));
    }
    Ok(())
}

fn verify_loaded_module(path: &Path) -> Result<()> {
    let name = wide(Path::new(
        path.file_name().ok_or_else(|| error(UNSAFE_PATH))?,
    ))?;
    let module = unsafe { GetModuleHandleW(name.as_ptr()) };
    if module.is_null() {
        return Err(error(UNSAFE_PATH));
    }
    let mut buffer = vec![0u16; 32768];
    let len =
        unsafe { GetModuleFileNameW(module, buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if len == 0
        || len >= buffer.len()
        || path_key(&PathBuf::from(OsString::from_wide(&buffer[..len])))? != path_key(path)?
    {
        return Err(error(UNSAFE_PATH));
    }
    Ok(())
}

struct Security {
    descriptor: PSECURITY_DESCRIPTOR,
    dacl: *mut ACL,
    owner: PSID,
    group: PSID,
}
impl Drop for Security {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.descriptor);
        }
    }
}
impl Security {
    fn read(file: &PinnedFile) -> Result<Self> {
        let mut value = Self {
            descriptor: null_mut(),
            dacl: null_mut(),
            owner: null_mut(),
            group: null_mut(),
        };
        let code = unsafe {
            GetSecurityInfo(
                file.handle.0,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION,
                &mut value.owner,
                &mut value.group,
                &mut value.dacl,
                null_mut(),
                &mut value.descriptor,
            )
        };
        if code != 0 {
            return Err(win_error(&file.path, "read DACL", code));
        }
        Ok(value)
    }
    fn control(&self) -> Result<u16> {
        let (mut control, mut revision) = (0, 0);
        if unsafe { GetSecurityDescriptorControl(self.descriptor, &mut control, &mut revision) }
            == 0
        {
            return Err(error(ACL_UNAVAILABLE));
        }
        Ok(control)
    }
    fn aces(&self) -> Result<Vec<Vec<u8>>> {
        if self.dacl.is_null() {
            return Ok(Vec::new());
        }
        if unsafe { IsValidAcl(self.dacl) } == 0 {
            return Err(error(DENY));
        }
        let mut aces = Vec::new();
        for index in 0..unsafe { (*self.dacl).AceCount } {
            let mut ace = null_mut();
            if unsafe { GetAce(self.dacl, index as u32, &mut ace) } == 0 {
                return Err(error(DENY));
            }
            let header = unsafe { &*ace.cast::<ACE_HEADER>() };
            if header.AceSize < 8 {
                return Err(error(DENY));
            }
            aces.push(
                unsafe { std::slice::from_raw_parts(ace.cast::<u8>(), header.AceSize as usize) }
                    .to_vec(),
            );
        }
        Ok(aces)
    }
}

fn mapped_mask(ace: &[u8]) -> Result<u32> {
    if ace.len() < 8 || !matches!(ace[0], 0 | 1) {
        return Err(error(DENY));
    }
    let mut mask = u32::from_le_bytes(ace[4..8].try_into().unwrap());
    let mapping = GENERIC_MAPPING {
        GenericRead: FILE_GENERIC_READ,
        GenericWrite: FILE_GENERIC_WRITE,
        GenericExecute: FILE_GENERIC_EXECUTE,
        GenericAll: FILE_ALL_ACCESS,
    };
    unsafe {
        MapGenericMask(&mut mask, &mapping);
    }
    Ok(mask)
}

fn validate_repair(aces: &[Vec<u8>]) -> Result<()> {
    for ace in aces {
        let mask = mapped_mask(ace)?;
        // Conservative: do not override any applicable RX deny, even for an
        // unmodelled group. Never move an allow ahead of an inherited deny.
        if ace[0] == 1 && ace[1] as u32 & INHERIT_ONLY_ACE == 0 && mask & RX != 0 {
            return Err(error(DENY));
        }
    }
    Ok(())
}

fn package_sid(package: u32) -> [u32; 4] {
    [0x0000_0201, 0x0f00_0000, 2, package]
}
fn allow_ace(package: u32) -> Vec<u8> {
    let mut ace = vec![0, 0, 24, 0]; // ACCESS_ALLOWED, no inheritance, 8 + 16 bytes.
    ace.extend_from_slice(&RX.to_le_bytes());
    for word in package_sid(package) {
        ace.extend_from_slice(&word.to_le_bytes());
    }
    ace
}
fn appended_aces(aces: &[Vec<u8>], missing: [bool; 2]) -> Vec<Vec<u8>> {
    let mut result = aces.to_vec();
    let position = result
        .iter()
        .position(|ace| ace[1] as u32 & INHERITED_ACE != 0)
        .unwrap_or(result.len());
    result.splice(
        position..position,
        missing
            .into_iter()
            .enumerate()
            .filter(|(_, missing)| *missing)
            .map(|(index, _)| allow_ace(index as u32 + 1)),
    );
    result
}

struct Acl(Vec<u32>);
impl Acl {
    fn ptr(&self) -> *const ACL {
        self.0.as_ptr().cast()
    }
    fn from_aces(aces: &[Vec<u8>], normalize: bool) -> Result<Self> {
        let size = size_of::<ACL>() + aces.iter().map(Vec::len).sum::<usize>();
        if size > u16::MAX as usize {
            return Err(error(DENY));
        }
        let mut value = Self(vec![0; size.div_ceil(4)]);
        let raw = value.0.as_mut_ptr().cast::<ACL>();
        if unsafe { InitializeAcl(raw, size as u32, ACL_REVISION) } == 0 {
            return Err(error(DENY));
        }
        for ace in aces {
            let mut bytes = ace.clone();
            if normalize {
                bytes[4..8].copy_from_slice(&mapped_mask(ace)?.to_le_bytes());
            }
            if unsafe {
                AddAce(
                    raw,
                    ACL_REVISION,
                    u32::MAX,
                    bytes.as_ptr().cast(),
                    bytes.len() as u32,
                )
            } == 0
            {
                return Err(error(DENY));
            }
        }
        Ok(value)
    }
}

struct PackageAccess {
    manager: AUTHZ_RESOURCE_MANAGER_HANDLE,
    contexts: [AUTHZ_CLIENT_CONTEXT_HANDLE; 2],
}
impl Drop for PackageAccess {
    fn drop(&mut self) {
        for context in self.contexts {
            if !context.is_null() {
                unsafe {
                    AuthzFreeContext(context);
                }
            }
        }
        if !self.manager.is_null() {
            unsafe {
                AuthzFreeResourceManager(self.manager);
            }
        }
    }
}
impl PackageAccess {
    fn new() -> Result<Self> {
        let mut value = Self {
            manager: null_mut(),
            contexts: [null_mut(); 2],
        };
        if unsafe {
            AuthzInitializeResourceManager(
                AUTHZ_RM_FLAG_NO_AUDIT,
                None,
                None,
                None,
                null(),
                &mut value.manager,
            )
        } == 0
        {
            return Err(error(ACL_UNAVAILABLE));
        }
        for index in 0..2 {
            let mut sid = package_sid(index as u32 + 1);
            // No domain/group lookup, credentials, profile creation or token
            // mutation. Check the two exact package SIDs independently. This
            // proves the required DACL grants, not a live CEF sandbox token.
            if unsafe {
                AuthzInitializeContextFromSid(
                    AUTHZ_SKIP_TOKEN_GROUPS,
                    sid.as_mut_ptr().cast(),
                    value.manager,
                    null(),
                    LUID {
                        LowPart: 0,
                        HighPart: 0,
                    },
                    null(),
                    &mut value.contexts[index],
                )
            } == 0
            {
                return Err(error(ACL_UNAVAILABLE));
            }
        }
        Ok(value)
    }
    fn missing(&self, security: &Security, aces: &[Vec<u8>]) -> Result<[bool; 2]> {
        if security.dacl.is_null() {
            return Ok([false; 2]);
        } // Existing null DACL: never rewrite.
        let normalized = Acl::from_aces(aces, true)?;
        let mut sd = unsafe { zeroed::<SECURITY_DESCRIPTOR>() };
        let descriptor = (&mut sd as *mut SECURITY_DESCRIPTOR).cast::<c_void>();
        if unsafe { InitializeSecurityDescriptor(descriptor, 1) } == 0
            || unsafe { SetSecurityDescriptorOwner(descriptor, security.owner, 0) } == 0
            || unsafe { SetSecurityDescriptorGroup(descriptor, security.group, 0) } == 0
            || unsafe { SetSecurityDescriptorDacl(descriptor, 1, normalized.ptr(), 0) } == 0
        {
            return Err(error(ACL_UNAVAILABLE));
        }
        let mut missing = [false; 2];
        for (index, context) in self.contexts.iter().enumerate() {
            let request = AUTHZ_ACCESS_REQUEST {
                DesiredAccess: RX,
                ..Default::default()
            };
            let (mut granted, mut status) = (0, 0);
            let mut reply = AUTHZ_ACCESS_REPLY {
                ResultListLength: 1,
                GrantedAccessMask: &mut granted,
                Error: &mut status,
                ..Default::default()
            };
            if unsafe {
                AuthzAccessCheck(
                    0,
                    *context,
                    &request,
                    null_mut(),
                    descriptor,
                    null(),
                    0,
                    &mut reply,
                    null_mut(),
                )
            } == 0
            {
                return Err(error(ACL_UNAVAILABLE));
            }
            if status != 0 && status != 5 {
                return Err(error(ACL_UNAVAILABLE));
            }
            missing[index] = status != 0 || granted & RX != RX;
        }
        Ok(missing)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_access_rx_and_sids_are_exact_noninheriting() {
        assert_eq!(RX, 0x0012_00a9);
        for package in [1, 2] {
            let ace = allow_ace(package);
            assert_eq!(&ace[..4], &[0, 0, 24, 0]);
            assert_eq!(&ace[8..20], &[1, 2, 0, 0, 0, 0, 0, 15, 2, 0, 0, 0]);
            assert_eq!(u32::from_le_bytes(ace[20..24].try_into().unwrap()), package);
        }
    }

    #[test]
    fn runtime_access_preserves_existing_aces_and_never_duplicates_satisfied_grants() {
        let mut inherited = allow_ace(1);
        inherited[1] = INHERITED_ACE as u8;
        let old = vec![inherited.clone()];
        assert_eq!(appended_aces(&old, [false, false]), old);
        assert_eq!(
            appended_aces(&old, [false, true]),
            vec![allow_ace(2), inherited]
        );
    }

    #[test]
    fn runtime_access_denies_and_unknown_aces_cannot_be_repaired_away() {
        let mut deny = allow_ace(1);
        deny[0] = 1;
        for flags in [0, INHERITED_ACE as u8] {
            deny[1] = flags;
            assert!(validate_repair(&[deny.clone()]).is_err());
        }
        deny[1] = INHERIT_ONLY_ACE as u8;
        assert!(validate_repair(&[deny]).is_ok());
        let mut conditional = allow_ace(1);
        conditional[0] = 9;
        assert!(validate_repair(&[conditional]).is_err());
    }

    #[test]
    fn runtime_access_locale_allowlist_has_no_traversal_or_arbitrary_dlls() {
        for name in ["en-US.pak", "sr_Latn.pak", "zh-TW.pak"] {
            assert!(locale_name(name));
        }
        for name in [
            ".pak",
            "../en-US.pak",
            "cookies.pak:secret",
            "en-US.dll",
            "en-US.pak/extra",
            "en-US.PAK",
        ] {
            assert!(!locale_name(name));
        }
        assert!(!FILES.contains(&"database.dll"));
        assert!(!FILES.contains(&"Cookies"));
    }

    #[test]
    fn runtime_access_rejects_unc_relative_and_parent_paths() {
        for path in [r"C:\bundle\app.exe", r"\\?\C:\bundle\app.exe"] {
            assert!(local_absolute(Path::new(path)));
        }
        for path in [
            r"C:app.exe",
            r"app.exe",
            r"\\server\share\app.exe",
            r"C:\bundle\..\app.exe",
        ] {
            assert!(!local_absolute(Path::new(path)));
        }
    }

    #[test]
    fn runtime_access_native_authz_distinguishes_both_package_sids() {
        let access = PackageAccess::new().unwrap();
        // This native test allocates only in-memory descriptors/contexts. No
        // filesystem ACLs, profile state, privileges or tokens are changed.
        let acl = Acl::from_aces(&[allow_ace(1)], false).unwrap();
        let mut system_sid = [0x0000_0101u32, 0x0500_0000, 18]; // S-1-5-18, not either package.
        let security = Security {
            descriptor: null_mut(),
            dacl: acl.ptr().cast_mut(),
            owner: system_sid.as_mut_ptr().cast(),
            group: system_sid.as_mut_ptr().cast(),
        };
        assert_eq!(
            access.missing(&security, &[allow_ace(1)]).unwrap(),
            [false, true]
        );
        let both = [allow_ace(1), allow_ace(2)];
        assert_eq!(access.missing(&security, &both).unwrap(), [false, false]);
        let mut inherited = allow_ace(2);
        inherited[1] = INHERITED_ACE as u8;
        assert_eq!(
            access
                .missing(&security, &[allow_ace(1), inherited.clone()])
                .unwrap(),
            [false, false]
        );
        inherited[1] |= INHERIT_ONLY_ACE as u8;
        assert_eq!(
            access
                .missing(&security, &[allow_ace(1), inherited])
                .unwrap(),
            [false, true]
        );
        let mut denied = allow_ace(2);
        denied[0] = 1;
        assert_eq!(
            access
                .missing(&security, &[denied, allow_ace(1), allow_ace(2)])
                .unwrap(),
            [false, true]
        );
    }

    #[test]
    fn runtime_access_generic_mapping_and_write_denies_are_preserved() {
        let mut generic = allow_ace(1);
        generic[4..8].copy_from_slice(&0xa000_0000u32.to_le_bytes());
        assert_eq!(mapped_mask(&generic).unwrap(), RX);
        let mut write_deny = allow_ace(1);
        write_deny[0] = 1;
        write_deny[4..8].copy_from_slice(&FILE_WRITE_DATA.to_le_bytes());
        validate_repair(&[write_deny.clone()]).unwrap();
        assert_eq!(
            appended_aces(&[write_deny.clone()], [true, true]),
            vec![write_deny, allow_ace(1), allow_ace(2)]
        );
    }

    #[test]
    fn runtime_access_write_control_preserves_only_existing_inheritance_state() {
        for existing in [
            0,
            SE_DACL_PROTECTED,
            SE_DACL_AUTO_INHERITED,
            SE_DACL_PROTECTED | SE_DACL_AUTO_INHERITED,
        ] {
            let write = dacl_write_control(0x8004 | existing).unwrap();
            assert_eq!(write & !SE_DACL_AUTO_INHERIT_REQ, existing);
            assert_eq!(
                write & SE_DACL_AUTO_INHERIT_REQ != 0,
                existing & SE_DACL_AUTO_INHERITED != 0
            );
            assert!(dacl_write_control(existing | SE_DACL_AUTO_INHERIT_REQ).is_err());
        }
    }

    #[test]
    fn runtime_access_file_repair_preserves_protected_and_inherited_controls() {
        let root = std::env::temp_dir().join(format!(
            "sorng-cef-acl-control-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        for control in [
            0,
            SE_DACL_PROTECTED,
            SE_DACL_AUTO_INHERITED,
            SE_DACL_PROTECTED | SE_DACL_AUTO_INHERITED,
        ] {
            let path = root.join(format!("control-{control:04x}.fixture"));
            fs::write(&path, b"").unwrap();
            {
                let file =
                    PinnedFile::open(&path.canonicalize().unwrap(), false, REPAIR_ACCESS).unwrap();
                let initial = Security::read(&file).unwrap();
                let aces = initial.aces().unwrap();
                // Seed only this disposable file with each supported state.
                write_dacl(&file, &Acl::from_aces(&aces, false).unwrap(), control).unwrap();
                let before = Security::read(&file).unwrap();
                assert_eq!(
                    before.control().unwrap() & (SE_DACL_PROTECTED | SE_DACL_AUTO_INHERITED),
                    control
                );
                let access = PackageAccess::new().unwrap();
                let missing = access.missing(&before, &aces).unwrap();
                let proposed = appended_aces(&aces, missing);
                write_dacl(
                    &file,
                    &Acl::from_aces(&proposed, false).unwrap(),
                    before.control().unwrap(),
                )
                .unwrap();
                let after = Security::read(&file).unwrap();
                assert_eq!(after.aces().unwrap(), proposed);
                assert_eq!(after.control().unwrap(), before.control().unwrap());
                assert_ne!(
                    unsafe { windows_sys::Win32::Security::EqualSid(before.owner, after.owner) },
                    0
                );
                assert_ne!(
                    unsafe { windows_sys::Win32::Security::EqualSid(before.group, after.group) },
                    0
                );
                assert_eq!(access.missing(&after, &proposed).unwrap(), [false, false]);
                assert_eq!(appended_aces(&proposed, [false, false]), proposed);
            }
            fs::remove_file(&path).unwrap();
        }
        fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn runtime_access_root_and_runtime_names_never_include_user_data() {
        assert!(FILES.iter().all(|name| !name.contains(['/', '\\', ':'])));
        for name in [
            "Cookies",
            "Local State",
            "Preferences",
            "login.sqlite",
            "profile",
            "databases",
            "user.dll",
        ] {
            assert!(!FILES.contains(&name));
        }
    }

    #[test]
    fn runtime_access_repairs_directory_with_traverse_pin_without_propagating() {
        // Isolated empty fixture only; no process-wide current-directory change.
        // FILE_GENERIC_EXECUTE simulates the no-delete-share Windows CWD pin.
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_file(self.0.join("profile/database.fixture"));
                let _ = fs::remove_dir(self.0.join("profile"));
                let _ = fs::remove_dir(&self.0);
            }
        }
        let fixture = Fixture(std::env::temp_dir().join(format!(
            "sorng-cef-acl-pin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        )));
        fs::create_dir(&fixture.0).unwrap();
        fs::create_dir(fixture.0.join("profile")).unwrap();
        fs::write(fixture.0.join("profile/database.fixture"), b"").unwrap();
        let root = fixture.0.canonicalize().unwrap();
        let _cwd_pin = PinnedFile::open(&root, true, FILE_GENERIC_EXECUTE).unwrap();
        let selected = PinnedFile::open(&root, true, READ_CONTROL | FILE_READ_ATTRIBUTES).unwrap();
        let name = wide(&root).unwrap();
        let old = unsafe {
            CreateFileW(
                name.as_ptr(),
                0x0200_0000,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
                null_mut(),
            )
        };
        let old_error = unsafe { GetLastError() };
        if old != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(old);
            }
        }
        assert_eq!(old, INVALID_HANDLE_VALUE);
        assert_eq!(old_error, 32); // The former MAXIMUM_ALLOWED sharing conflict.
        let writable = PinnedFile::open(&root, true, REPAIR_ACCESS).unwrap();
        assert!(selected.same_file(&writable));
        let child = PinnedFile::open(
            &root.join("profile"),
            true,
            READ_CONTROL | FILE_READ_ATTRIBUTES,
        )
        .unwrap();
        let data = PinnedFile::open(
            &root.join("profile").join("database.fixture"),
            false,
            READ_CONTROL | FILE_READ_ATTRIBUTES,
        )
        .unwrap();
        let snapshot = |file: &PinnedFile| {
            let security = Security::read(file).unwrap();
            unsafe {
                std::slice::from_raw_parts(
                    security.descriptor.cast::<u8>(),
                    windows_sys::Win32::Security::GetSecurityDescriptorLength(security.descriptor)
                        as usize,
                )
                .to_vec()
            }
        };
        let children_before = (snapshot(&child), snapshot(&data));
        let before = Security::read(&writable).unwrap();
        assert_ne!(
            before.control().unwrap() & SE_DACL_AUTO_INHERITED,
            0,
            "fresh fixture must exercise the cold auto-inherited DACL"
        );
        let mut seeded = before.aces().unwrap();
        let mut inherited_candidate = allow_ace(1);
        inherited_candidate[1] = 3; // Fixture-only old inheritable ACE.
        inherited_candidate[4..8].copy_from_slice(&FILE_READ_ATTRIBUTES.to_le_bytes());
        seeded.insert(0, inherited_candidate);
        write_dacl(
            &writable,
            &Acl::from_aces(&seeded, false).unwrap(),
            before.control().unwrap(),
        )
        .unwrap();
        // A high-level tree update would propagate that old ACE to the child.
        // Check the FIRST write too: the original test read a new baseline here,
        // hiding NtSetSecurityObject clearing SE_DACL_AUTO_INHERITED in setup.
        assert_eq!(
            Security::read(&writable).unwrap().control().unwrap(),
            before.control().unwrap(),
            "first write must preserve the freshly inherited directory control"
        );
        let before = Security::read(&writable).unwrap();
        let access = PackageAccess::new().unwrap();
        let missing = access.missing(&before, &seeded).unwrap();
        let proposed = appended_aces(&seeded, missing);
        write_dacl(
            &writable,
            &Acl::from_aces(&proposed, false).unwrap(),
            before.control().unwrap(),
        )
        .unwrap();
        let after = Security::read(&writable).unwrap();
        assert_eq!(after.aces().unwrap(), proposed);
        assert_eq!(after.control().unwrap(), before.control().unwrap());
        assert_ne!(
            unsafe { windows_sys::Win32::Security::EqualSid(before.owner, after.owner) },
            0
        );
        assert_ne!(
            unsafe { windows_sys::Win32::Security::EqualSid(before.group, after.group) },
            0
        );
        assert_eq!(access.missing(&after, &proposed).unwrap(), [false, false]);
        assert_eq!((snapshot(&child), snapshot(&data)), children_before);
    }
}
