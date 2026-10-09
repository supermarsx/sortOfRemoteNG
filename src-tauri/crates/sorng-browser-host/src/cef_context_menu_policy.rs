//! Deliberately small allowlist. No Chromium default command may fall through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub(super) enum Action {
    Back = 26500,
    Forward,
    Reload,
    Stop,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    Delete,
    SelectAll,
    DevTools,
}

impl Action {
    pub(super) const ALL: [Self; 12] = [
        Self::Back,
        Self::Forward,
        Self::Reload,
        Self::Stop,
        Self::Undo,
        Self::Redo,
        Self::Cut,
        Self::Copy,
        Self::Paste,
        Self::Delete,
        Self::SelectAll,
        Self::DevTools,
    ];

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Back => "Back",
            Self::Forward => "Forward",
            Self::Reload => "Reload",
            Self::Stop => "Stop loading",
            Self::Undo => "Undo",
            Self::Redo => "Redo",
            Self::Cut => "Cut",
            Self::Copy => "Copy",
            Self::Paste => "Paste",
            Self::Delete => "Delete",
            Self::SelectAll => "Select all",
            Self::DevTools => "Developer tools",
        }
    }

    pub(super) fn group(self) -> u8 {
        match self {
            Self::Back | Self::Forward | Self::Reload | Self::Stop => 0,
            Self::DevTools => 2,
            _ => 1,
        }
    }

    pub(super) fn edit_bit(self) -> u32 {
        match self {
            Self::Undo => 1,
            Self::Redo => 2,
            Self::Cut => 4,
            Self::Copy => 8,
            Self::Paste => 16,
            Self::Delete => 32,
            Self::SelectAll => 64,
            _ => 0,
        }
    }
}

#[derive(Default, Clone, Copy)]
pub(super) struct MenuState {
    pub back: bool,
    pub forward: bool,
    pub loading: bool,
    pub editable: bool,
    pub edit_flags: u32,
}

impl MenuState {
    pub(super) fn visible(self, action: Action) -> bool {
        action.group() != 1
            || self.editable
            || matches!(action, Action::Copy | Action::SelectAll) && self.enabled(action)
    }

    pub(super) fn enabled(self, action: Action) -> bool {
        match action {
            Action::Back => self.back,
            Action::Forward => self.forward,
            Action::Stop => self.loading,
            Action::Reload | Action::DevTools => true,
            Action::Copy | Action::SelectAll => self.edit_flags & action.edit_bit() != 0,
            _ => self.editable && self.edit_flags & action.edit_bit() != 0,
        }
    }

    pub(super) fn rows(self) -> Vec<(Action, bool)> {
        Action::ALL
            .into_iter()
            .filter(|action| self.visible(*action))
            .map(|action| (action, self.enabled(action)))
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Document {
    pub browser: i32,
    pub generation: u64,
    pub frame: String,
    pub url: String,
}

pub(super) struct Receipt {
    pub document: Document,
    pub rows: Vec<(Action, bool)>,
}

impl Receipt {
    pub(super) fn resolve(&self, document: &Document, state: MenuState, id: i32) -> Option<Action> {
        if &self.document != document {
            return None;
        }
        self.rows.iter().find_map(|(action, enabled)| {
            (*action as i32 == id && *enabled && state.visible(*action) && state.enabled(*action))
                .then_some(*action)
        })
    }
}
