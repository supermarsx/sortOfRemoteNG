use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

pub struct Options {
    pub profile: PathBuf,
    pub smoke: bool,
    pub hidden_hold: bool,
}

pub fn options(args: impl IntoIterator<Item = OsString>) -> Result<Options, &'static str> {
    let mut args = args.into_iter();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--profile-dir")) {
        return Err("profile argument required");
    }
    let profile = PathBuf::from(args.next().ok_or("profile missing")?);
    let (smoke, hidden_hold) = match args.next() {
        None => (false, false),
        Some(value) if value == "--smoke-test" => (true, false),
        Some(value) if cfg!(debug_assertions) && value == "--smoke-hold" => (false, true),
        _ => return Err("unsupported option"),
    };
    if args.next().is_some() {
        return Err("extra option");
    }
    validate_profile(&profile)?;
    Ok(Options {
        profile,
        smoke,
        hidden_hold,
    })
}

pub fn validate_profile(path: &Path) -> Result<(), &'static str> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
    {
        return Err("invalid profile");
    }
    // Parent creates this private directory. No source path or document is ever written.
    for ancestor in path.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor).map_err(|_| "profile inaccessible")?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("unsafe profile");
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("reparse profile");
            }
        }
    }
    if std::fs::read_dir(path)
        .map_err(|_| "profile inaccessible")?
        .next()
        .is_some()
    {
        return Err("profile not empty");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fresh_absolute_empty_profile_and_exact_cli_are_accepted() {
        let temp = tempfile::tempdir().unwrap();
        let args = vec!["--profile-dir".into(), temp.path().as_os_str().to_owned()];
        assert!(!options(args.clone()).unwrap().smoke);
        let mut smoke = args.clone();
        smoke.push("--smoke-test".into());
        assert!(options(smoke).unwrap().smoke);
        let mut injection = args;
        injection.push("--edge-webview-switches=--no-sandbox".into());
        assert!(options(injection).is_err());
        assert!(validate_profile(Path::new("relative")).is_err());
        std::fs::write(temp.path().join("existing-profile"), b"x").unwrap();
        assert!(validate_profile(temp.path()).is_err());
    }
}
