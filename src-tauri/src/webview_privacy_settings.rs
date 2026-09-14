//! Dependency-free engine-policy enforcement, used by the real Windows adapter
//! and directly testable without linking the full desktop application.

pub(crate) trait FormPrivacySettings {
    fn disable_general_autofill(&mut self) -> Result<(), ()>;
    fn disable_password_autosave(&mut self) -> Result<(), ()>;
    fn general_autofill_enabled(&self) -> Result<bool, ()>;
    fn password_autosave_enabled(&self) -> Result<bool, ()>;
}

pub(crate) fn enforce(settings: &mut impl FormPrivacySettings) -> Result<(), ()> {
    // Apply both before verifying. This changes engine settings, not page
    // heuristics, so app-owned controlled-input filling continues to work.
    settings.disable_general_autofill()?;
    settings.disable_password_autosave()?;
    if settings.general_autofill_enabled()? || settings.password_autosave_enabled()? {
        return Err(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{enforce, FormPrivacySettings};
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fixture {
        general: bool,
        passwords: bool,
        fail: Option<&'static str>,
        ignore: Option<&'static str>,
        calls: RefCell<Vec<&'static str>>,
    }
    impl Fixture {
        fn call(&self, name: &'static str) -> Result<(), ()> {
            self.calls.borrow_mut().push(name);
            if self.fail == Some(name) {
                Err(())
            } else {
                Ok(())
            }
        }
    }
    impl FormPrivacySettings for Fixture {
        fn disable_general_autofill(&mut self) -> Result<(), ()> {
            self.call("disable-general")?;
            if self.ignore != Some("general") {
                self.general = false;
            }
            Ok(())
        }
        fn disable_password_autosave(&mut self) -> Result<(), ()> {
            self.call("disable-passwords")?;
            if self.ignore != Some("passwords") {
                self.passwords = false;
            }
            Ok(())
        }
        fn general_autofill_enabled(&self) -> Result<bool, ()> {
            self.call("read-general")?;
            Ok(self.general)
        }
        fn password_autosave_enabled(&self) -> Result<bool, ()> {
            self.call("read-passwords")?;
            Ok(self.passwords)
        }
    }

    #[test]
    fn disables_and_verifies_both_engine_features() {
        let mut fixture = Fixture {
            general: true,
            passwords: true,
            ..Fixture::default()
        };
        assert_eq!(enforce(&mut fixture), Ok(()));
        assert!(!fixture.general && !fixture.passwords);
        assert_eq!(
            *fixture.calls.borrow(),
            [
                "disable-general",
                "disable-passwords",
                "read-general",
                "read-passwords"
            ]
        );
    }

    #[test]
    fn already_disabled_is_idempotently_verified() {
        let mut fixture = Fixture::default();
        assert_eq!(enforce(&mut fixture), Ok(()));
        assert_eq!(enforce(&mut fixture), Ok(()));
        assert_eq!(fixture.calls.borrow().len(), 8);
    }

    #[test]
    fn every_failed_setter_or_readback_refuses_success() {
        for fail in [
            "disable-general",
            "disable-passwords",
            "read-general",
            "read-passwords",
        ] {
            let mut fixture = Fixture {
                general: true,
                passwords: true,
                fail: Some(fail),
                ..Fixture::default()
            };
            assert_eq!(enforce(&mut fixture), Err(()), "{fail}");
        }
    }

    #[test]
    fn silently_ignored_settings_are_detected() {
        for ignore in ["general", "passwords"] {
            let mut fixture = Fixture {
                general: true,
                passwords: true,
                ignore: Some(ignore),
                ..Fixture::default()
            };
            assert_eq!(enforce(&mut fixture), Err(()), "{ignore}");
        }
    }
}
