//! Deliberately small allowlist. No Chromium default command may fall through.
//!
//! Rows follow what was clicked, as in a desktop browser. Left out on purpose:
//! - "Save link as" / "Save image as": the download adapter never starts a
//!   download for the host, and request admission has no owner for one.
//! - Search provider, translate, cast / send to device: external services.
//! - "View page source": CEF saves the page to a temporary file and opens
//!   the system's text viewer on it.
//! - "Copy image" as a bitmap: needs per-platform bitmap clipboard code.
//! - Spelling suggestions: this runtime configures no spellcheck dictionary.
//! - Typing saved credentials: that stays a toolbar action.
use crate::native_popups::tab_destination;

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
    // Appended, so the twelve ids above keep their values.
    OpenLink,
    CopyLinkAddress,
    OpenImage,
    CopyImageAddress,
    OpenVideo,
    CopyVideoAddress,
    OpenAudio,
    CopyAudioAddress,
    PasteAsPlainText,
    Print,
    Inspect,
}

impl Action {
    /// Display order, top to bottom. This is not id order.
    pub(super) const ALL: [Self; 23] = [
        Self::OpenLink,
        Self::CopyLinkAddress,
        Self::OpenImage,
        Self::CopyImageAddress,
        Self::OpenVideo,
        Self::CopyVideoAddress,
        Self::OpenAudio,
        Self::CopyAudioAddress,
        Self::Back,
        Self::Forward,
        Self::Reload,
        Self::Stop,
        Self::Undo,
        Self::Redo,
        Self::Cut,
        Self::Copy,
        Self::Paste,
        Self::PasteAsPlainText,
        Self::Delete,
        Self::SelectAll,
        Self::Print,
        Self::Inspect,
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
            Self::OpenLink => "Open link in new tab",
            Self::CopyLinkAddress => "Copy link address",
            Self::OpenImage => "Open image in new tab",
            Self::CopyImageAddress => "Copy image address",
            Self::OpenVideo => "Open video in new tab",
            Self::CopyVideoAddress => "Copy video address",
            Self::OpenAudio => "Open audio in new tab",
            Self::CopyAudioAddress => "Copy audio address",
            Self::PasteAsPlainText => "Paste as plain text",
            Self::Print => "Print",
            Self::Inspect => "Inspect",
        }
    }

    /// Neighbouring rows of different groups get a separator between them.
    pub(super) fn group(self) -> u8 {
        match self {
            Self::OpenLink | Self::CopyLinkAddress => 0,
            Self::OpenImage
            | Self::CopyImageAddress
            | Self::OpenVideo
            | Self::CopyVideoAddress
            | Self::OpenAudio
            | Self::CopyAudioAddress => 1,
            Self::Back | Self::Forward | Self::Reload | Self::Stop => 2,
            Self::Print => 4,
            Self::Inspect | Self::DevTools => 5,
            _ => 3,
        }
    }

    pub(super) fn edit_bit(self) -> u32 {
        match self {
            Self::Undo => 1,
            Self::Redo => 2,
            Self::Cut => 4,
            Self::Copy => 8,
            Self::Paste | Self::PasteAsPlainText => 16,
            Self::Delete => 32,
            Self::SelectAll => 64,
            _ => 0,
        }
    }

    /// The clicked media element a row belongs to. `Media::None` for the
    /// link rows and for every row that is not bound to an address.
    fn media(self) -> Media {
        match self {
            Self::OpenImage | Self::CopyImageAddress => Media::Image,
            Self::OpenVideo | Self::CopyVideoAddress => Media::Video,
            Self::OpenAudio | Self::CopyAudioAddress => Media::Audio,
            _ => Media::None,
        }
    }

    fn opens(self) -> bool {
        matches!(
            self,
            Self::OpenLink | Self::OpenImage | Self::OpenVideo | Self::OpenAudio
        )
    }

    fn copies(self) -> bool {
        matches!(
            self,
            Self::CopyLinkAddress
                | Self::CopyImageAddress
                | Self::CopyVideoAddress
                | Self::CopyAudioAddress
        )
    }
}

/// Longest address a row carries, as in `navigate()`.
pub(super) const MAX_ADDRESS: usize = 16_384;

/// "Copy ... address" takes whatever address the page shows, of any scheme.
pub(super) fn copyable(address: &str) -> bool {
    !address.is_empty() && address.len() <= MAX_ADDRESS && !address.chars().any(char::is_control)
}

/// What the menu may do with a clicked link or media source.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Address {
    /// A destination `open_tab()` would take.
    pub open: bool,
    /// Text the clipboard writer would take.
    pub copy: bool,
}

impl Address {
    /// `validated` is `link_url()`, the address the browser process vouches
    /// for. `unfiltered` is `unfiltered_link_url()`, which CEF reserves for
    /// "copy link address". Both are the link's resolved, escaped address,
    /// never the attribute text, and they are equal unless the browser
    /// process replaced the validated one: for `javascript:void(0)` the
    /// engine reports `about:blank#blocked` and the original (measured, CEF
    /// 154.3.0, 2026-10-12). Only the first is ever opened and only the
    /// second copied. `admitted` says whether a new tab may be opened for
    /// an http(s) address; `open_tab()` decides again at command time.
    pub(super) fn of(
        validated: &str,
        unfiltered: &str,
        admitted: impl FnOnce(&str) -> bool,
    ) -> Self {
        Self {
            open: tab_destination(Some(validated), || None).is_ok() && admitted(validated),
            copy: copyable(unfiltered),
        }
    }

    /// The element was clicked, whatever may be done with its address.
    fn present(self) -> bool {
        self.open || self.copy
    }
}

/// The clicked element kinds that have a source address worth offering.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Media {
    #[default]
    None,
    Image,
    Video,
    Audio,
}

#[derive(Default, Clone, Copy)]
pub(super) struct MenuState {
    pub back: bool,
    pub forward: bool,
    pub loading: bool,
    pub editable: bool,
    pub edit_flags: u32,
    pub link: Address,
    /// The clicked element's kind, and its source address.
    pub media: Media,
    pub source: Address,
    /// This platform has a clipboard text writer.
    pub clipboard: bool,
    /// The click point is one "Inspect" may hand to the engine.
    pub inspect: bool,
}

impl MenuState {
    /// The clicked address a link or media row acts on.
    fn address(self, action: Action) -> Address {
        match action.media() {
            Media::None => self.link,
            media if media == self.media => self.source,
            _ => Address::default(),
        }
    }

    pub(super) fn visible(self, action: Action) -> bool {
        match action {
            action if action.opens() => self.address(action).present(),
            // Without a writer the copy rows are not offered at all.
            action if action.copies() => self.clipboard && self.address(action).present(),
            Action::Copy | Action::SelectAll => self.editable || self.enabled(action),
            Action::Undo
            | Action::Redo
            | Action::Cut
            | Action::Paste
            | Action::PasteAsPlainText
            | Action::Delete => self.editable,
            _ => true,
        }
    }

    pub(super) fn enabled(self, action: Action) -> bool {
        match action {
            action if action.opens() => self.address(action).open,
            action if action.copies() => self.clipboard && self.address(action).copy,
            Action::Back => self.back,
            Action::Forward => self.forward,
            Action::Stop => self.loading,
            // The host does not print a document that is still loading.
            Action::Print => !self.loading,
            Action::Inspect => self.inspect,
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

/// Exactly what was clicked. Page-supplied text: kept for the command, never
/// logged.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Target {
    /// The link as the browser process validated it: what a new tab opens.
    pub link: String,
    /// The link before that validation, resolved and escaped: what is
    /// copied.
    pub unfiltered_link: String,
    pub source: String,
    pub point: (i32, i32),
}

/// What a resolved row asks of the host. Edit rows act on the clicked frame
/// instead and have no command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Command {
    Back,
    Forward,
    Reload,
    Stop,
    DevTools,
    Inspect(i32, i32),
    Print,
    OpenTab(String),
    CopyText(String),
}

impl Target {
    pub(super) fn command(&self, action: Action) -> Option<Command> {
        Some(match action {
            Action::Back => Command::Back,
            Action::Forward => Command::Forward,
            Action::Reload => Command::Reload,
            Action::Stop => Command::Stop,
            Action::DevTools => Command::DevTools,
            Action::Inspect => Command::Inspect(self.point.0, self.point.1),
            Action::Print => Command::Print,
            Action::OpenLink => Command::OpenTab(self.link.clone()),
            Action::CopyLinkAddress => Command::CopyText(self.unfiltered_link.clone()),
            action if action.opens() => Command::OpenTab(self.source.clone()),
            action if action.copies() => Command::CopyText(self.source.clone()),
            _ => return None,
        })
    }
}

pub(super) struct Receipt {
    pub document: Document,
    pub rows: Vec<(Action, bool)>,
    pub target: Target,
}

impl Receipt {
    pub(super) fn resolve(
        &self,
        document: &Document,
        state: MenuState,
        target: &Target,
        id: i32,
    ) -> Option<Action> {
        // The clicked addresses and point are part of the gesture: a command
        // never acts on a link or element other than the one the menu showed.
        if &self.document != document || &self.target != target {
            return None;
        }
        self.rows.iter().find_map(|(action, enabled)| {
            (*action as i32 == id && *enabled && state.visible(*action) && state.enabled(*action))
                .then_some(*action)
        })
    }
}
