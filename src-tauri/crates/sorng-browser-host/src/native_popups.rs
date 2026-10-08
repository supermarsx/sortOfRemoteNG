//! UI-thread child-view lifecycle for one existing native Attempt.
//!
//! No creation, credentials, proxy, IPC registration or parent-revocation API
//! lives here. The CEF adapter reserves in OnBeforePopup and attaches the ACTUAL
//! browser in OnAfterCreated; replaying a target URL is not popup adoption.
//! Keep this registry and the parent's context alive until `drained()` after
//! OnBeforeClose/OnBeforePopupAborted acknowledgements, including late creates.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

pub const MAX_POPUP_VIEWS: usize = 16;
pub const POPUP_ADOPTION_TIMEOUT: Duration = Duration::from_secs(15);

/// Native saved-global preference, never a renderer creation flag. Hosts start
/// blocked until their existing source authority installs this value once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativePopupPolicy {
    Tabs,
    Block,
}

/// Copy from the native source Attempt, never from a new connection/session.
#[derive(Clone, PartialEq, Eq)]
pub struct PopupSourceIdentity {
    pub owner_database_id: String,
    pub connection_id: String,
    pub session_id: String,
    pub attempt_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PopupDisposition {
    Foreground,
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PopupPhase {
    Pending,
    Available,
    Adopted,
    Closing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PopupError {
    OwnerUnavailable,
    InvalidSource,
    InvalidDestination,
    GestureRequired,
    LimitReached,
    DuplicateRequest,
    UnknownView,
    InvalidTransition,
    ContextMismatch,
    NativeCloseFailed,
}

/// Resolve an explicit owner-shell address or read the actual selected native
/// frame. The CEF caller must still run full native navigation authorization.
#[cfg(any(feature = "cef-host", test))]
pub(crate) fn tab_destination(
    address: Option<&str>,
    native_url: impl FnOnce() -> Option<String>,
) -> Result<String, PopupError> {
    // No cached display URL or inert bootstrap fallback on missing native URL.
    let target = match address {
        Some(address) if address.len() <= 16_384 => address.to_owned(),
        Some(_) => return Err(PopupError::InvalidDestination),
        None => native_url().ok_or(PopupError::InvalidDestination)?,
    };
    if target.len() > 16_384
        || target.chars().any(char::is_control)
        || !(target.starts_with("http://") || target.starts_with("https://"))
    {
        return Err(PopupError::InvalidDestination);
    }
    // Full URL parsing, credential rejection and origin/navigation permission
    // checks remain authoritative in the host and the popup reservation.
    Ok(target)
}

/// Implement with the EXACT source lease and destination policy. C is the
/// shared lifetime anchor for its private CEF context, session and relay.
/// `destination_allowed` must parse/validate a complete HTTP(S) URL or permit
/// the inert about:blank bootstrap. All subsequent navigation/resource loads
/// still use the existing native policy, including redirects and subresources.
pub trait PopupAuthority<C> {
    fn current(&self, context: &Rc<C>) -> bool;
    fn destination_allowed(&self, context: &Rc<C>, target: &str) -> bool;
}

/// Adapter for one real CEF child. request_close must hide/unfocus the child,
/// schedule view-only CEF teardown and retain its callback until OnBeforeClose.
/// It MUST NOT call CefBrowserHost::close, Shared::revoke, or Attempt::revoke.
pub trait PopupView {
    fn browser_id(&self) -> i32;
    fn request_close(&mut self) -> Result<(), PopupError>;
}

struct Entry<V> {
    opener_browser_id: i32,
    popup_id: i32,
    disposition: PopupDisposition,
    phase: PopupPhase,
    deadline: Instant,
    view: Option<V>,
    close_sent: bool,
}

/// Owner-window inventory contains IDs and lifecycle only, never URLs, context
/// handles, credentials, native window handles or proxy information.
pub struct PopupInventory {
    pub source_identity: PopupSourceIdentity,
    pub sequence: u64,
    pub source_closed: bool,
    pub views: Vec<PopupViewInfo>,
}

pub struct PopupViewInfo {
    pub view_id: String,
    pub disposition: PopupDisposition,
    pub phase: PopupPhase,
}

/// Rc deliberately prevents moving this registry or its native handles off the
/// UI thread. Context identity uses pointer equality, never matching DB strings.
pub struct PopupRegistry<C, V: PopupView, A: PopupAuthority<C>> {
    source: PopupSourceIdentity,
    owner_window: String,
    parent_browser_id: i32,
    context: Rc<C>,
    authority: A,
    entries: BTreeMap<String, Entry<V>>,
    // Rejected late/mismatched native creations also need close ACKs before
    // their context references can be released.
    rejected: BTreeMap<i32, (V, Rc<C>, bool)>,
    next_id: u64,
    sequence: u64,
    source_closed: bool,
}

impl<C, V: PopupView, A: PopupAuthority<C>> PopupRegistry<C, V, A> {
    pub fn new(
        source: PopupSourceIdentity,
        owner_window: String,
        parent_browser_id: i32,
        context: Rc<C>,
        authority: A,
    ) -> Result<Self, PopupError> {
        if [
            &source.owner_database_id,
            &source.connection_id,
            &source.session_id,
            &source.attempt_id,
            &owner_window,
        ]
        .iter()
        .any(|id| {
            id.is_empty()
                || id.len() > 256
                || id.chars().any(|c| c.is_control() || c.is_whitespace())
        }) || parent_browser_id <= 0
        {
            return Err(PopupError::InvalidSource);
        }
        if !authority.current(&context) {
            return Err(PopupError::OwnerUnavailable);
        }
        Ok(Self {
            source,
            owner_window,
            parent_browser_id,
            context,
            authority,
            entries: BTreeMap::new(),
            rejected: BTreeMap::new(),
            next_id: 0,
            sequence: 0,
            source_closed: false,
        })
    }

    fn current(&self) -> Result<(), PopupError> {
        if self.source_closed || !self.authority.current(&self.context) {
            Err(PopupError::OwnerUnavailable)
        } else {
            Ok(())
        }
    }

    fn owner(&self, window: &str, source: &PopupSourceIdentity) -> Result<(), PopupError> {
        if window != self.owner_window || source != &self.source {
            Err(PopupError::InvalidSource)
        } else {
            Ok(())
        }
    }

    /// Call only from a validated native opener browser/frame callback. Map
    /// ONLY CEF NEW_FOREGROUND_TAB/NEW_BACKGROUND_TAB/NEW_POPUP to disposition;
    /// unsupported dispositions remain cancelled by the adapter.
    pub fn reserve(
        &mut self,
        opener_browser_id: i32,
        popup_id: i32,
        target: &str,
        disposition: PopupDisposition,
        user_gesture: bool,
        now: Instant,
    ) -> Result<String, PopupError> {
        self.current()?;
        let opener_is_child = self.entries.values().any(|entry| {
            matches!(entry.phase, PopupPhase::Available | PopupPhase::Adopted)
                && entry
                    .view
                    .as_ref()
                    .is_some_and(|v| v.browser_id() == opener_browser_id)
        });
        if opener_browser_id != self.parent_browser_id && !opener_is_child {
            return Err(PopupError::InvalidSource);
        }
        if !user_gesture {
            return Err(PopupError::GestureRequired);
        }
        if target.len() > 16_384
            || target.chars().any(char::is_control)
            || !(target == "about:blank"
                || target.starts_with("http://")
                || target.starts_with("https://"))
            || !self.authority.destination_allowed(&self.context, target)
        {
            return Err(PopupError::InvalidDestination);
        }
        if self.entries.len() + self.rejected.len() >= MAX_POPUP_VIEWS {
            return Err(PopupError::LimitReached);
        }
        if self
            .entries
            .values()
            .any(|e| e.opener_browser_id == opener_browser_id && e.popup_id == popup_id)
        {
            return Err(PopupError::DuplicateRequest);
        }
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or(PopupError::LimitReached)?;
        let id = format!("popup-{}", self.next_id);
        self.entries.insert(
            id.clone(),
            Entry {
                opener_browser_id,
                popup_id,
                disposition,
                phase: PopupPhase::Pending,
                deadline: now + POPUP_ADOPTION_TIMEOUT,
                view: None,
                close_sent: false,
            },
        );
        self.sequence += 1;
        Ok(id)
    }

    /// Attach the browser CEF actually created; it must still be hidden. The
    /// adapter must verify RequestContext::is_same before supplying this exact
    /// context anchor. No context may be reconstructed from the source IDs.
    pub fn attach(
        &mut self,
        id: &str,
        context: Rc<C>,
        view: V,
        now: Instant,
    ) -> Result<(), PopupError> {
        self.attach_verified(id, context, view, true, now)
    }

    /// The adapter supplies CEF RequestContext::is_same, not an identity-string
    /// comparison. A mismatch is retained for close ACK, never made adoptable.
    pub fn attach_verified(
        &mut self,
        id: &str,
        context: Rc<C>,
        mut view: V,
        same_native_context: bool,
        now: Instant,
    ) -> Result<(), PopupError> {
        let browser_id = view.browser_id();
        if browser_id <= 0
            || browser_id == self.parent_browser_id
            || self.rejected.contains_key(&browser_id)
            || self.entries.values().any(|e| {
                e.view
                    .as_ref()
                    .is_some_and(|v| v.browser_id() == browser_id)
            })
        {
            return Err(PopupError::InvalidSource);
        }
        let valid_context = same_native_context && Rc::ptr_eq(&self.context, &context);
        let admitted = self.current().is_ok()
            && valid_context
            && self
                .entries
                .get(id)
                .is_some_and(|entry| entry.phase == PopupPhase::Pending && entry.deadline > now);
        if !admitted {
            let sent = view.request_close().is_ok();
            self.rejected.insert(browser_id, (view, context, sent));
            if self.entries.get(id).is_some_and(|e| e.view.is_none()) {
                self.entries.remove(id);
            }
            self.sequence += 1;
            return Err(if valid_context {
                PopupError::InvalidTransition
            } else {
                PopupError::ContextMismatch
            });
        }
        let entry = self.entries.get_mut(id).ok_or(PopupError::UnknownView)?;
        entry.view = Some(view);
        entry.phase = PopupPhase::Available;
        // Adoption receives its own bounded window after actual CEF creation.
        entry.deadline = now + POPUP_ADOPTION_TIMEOUT;
        self.sequence += 1;
        Ok(())
    }

    pub fn adopt(
        &mut self,
        window: &str,
        source: &PopupSourceIdentity,
        id: &str,
        now: Instant,
    ) -> Result<(), PopupError> {
        self.owner(window, source)?;
        self.current()?;
        let entry = self.entries.get_mut(id).ok_or(PopupError::UnknownView)?;
        match entry.phase {
            PopupPhase::Adopted => Ok(()), // Lost reply/retry never recreates it.
            PopupPhase::Available if entry.deadline > now => {
                entry.phase = PopupPhase::Adopted;
                self.sequence += 1;
                Ok(())
            }
            _ => Err(PopupError::InvalidTransition),
        }
    }

    /// Revalidate a queued native new-tab creation immediately before calling
    /// CEF. Expired/closed reservations may never start a browser later.
    pub fn pending_current(&self, id: &str, now: Instant) -> bool {
        self.current().is_ok()
            && self
                .entries
                .get(id)
                .is_some_and(|entry| entry.phase == PopupPhase::Pending && entry.deadline > now)
    }

    /// Deferred explicit/link tabs must recheck destination policy at execution,
    /// not carry an earlier permission decision across a queued UI task.
    pub fn pending_navigation_allowed(&self, id: &str, target: &str, now: Instant) -> bool {
        self.pending_current(id, now)
            && target.len() <= 16_384
            && !target.chars().any(char::is_control)
            && (target == "about:blank"
                || target.starts_with("http://")
                || target.starts_with("https://"))
            && self.authority.destination_allowed(&self.context, target)
    }

    /// Native navigation/presentation uses the exact adopted view. A background
    /// adoption does not focus/show it; the owner selects a view explicitly.
    pub fn with_view<R>(
        &mut self,
        window: &str,
        source: &PopupSourceIdentity,
        id: &str,
        action: impl FnOnce(&mut V) -> R,
    ) -> Result<R, PopupError> {
        self.owner(window, source)?;
        self.current()?;
        let entry = self.entries.get_mut(id).ok_or(PopupError::UnknownView)?;
        if entry.phase != PopupPhase::Adopted {
            return Err(PopupError::InvalidTransition);
        }
        Ok(action(entry.view.as_mut().ok_or(PopupError::UnknownView)?))
    }

    fn close_entry(entry: &mut Entry<V>) -> Result<(), PopupError> {
        entry.phase = PopupPhase::Closing;
        if !entry.close_sent {
            if let Some(view) = &mut entry.view {
                view.request_close()?;
                entry.close_sent = true;
            }
        }
        Ok(())
    }

    /// Closing stays authorized for its original window after lease revocation.
    /// Never touches parent authority, its relay or sibling views.
    pub fn close_view(
        &mut self,
        window: &str,
        source: &PopupSourceIdentity,
        id: &str,
    ) -> Result<(), PopupError> {
        self.owner(window, source)?;
        let Some(entry) = self.entries.get_mut(id) else {
            return Ok(());
        };
        self.sequence += 1;
        Self::close_entry(entry)
    }

    /// Parent revocation must revoke its relay first in the existing Attempt.
    /// The registry then closes every child, including pending creations. Keep
    /// pumping CEF and retain the registry/context until all ACKs arrive.
    pub fn close_source(&mut self) -> Result<(), PopupError> {
        if !self.source_closed {
            self.sequence += 1;
        }
        self.source_closed = true;
        let mut failed = false;
        for entry in self.entries.values_mut() {
            failed |= Self::close_entry(entry).is_err();
        }
        for (view, _, sent) in self.rejected.values_mut() {
            if !*sent {
                *sent = view.request_close().is_ok();
            }
            failed |= !*sent;
        }
        if failed {
            Err(PopupError::NativeCloseFailed)
        } else {
            Ok(())
        }
    }

    /// Call from the existing native UI pump. Expiry cancels abandoned creates
    /// and unavailable/adoption-failed children without affecting the parent.
    pub fn maintain(&mut self, now: Instant) -> Result<(), PopupError> {
        if self.current().is_err() {
            return self.close_source();
        }
        let mut failed = false;
        for entry in self.entries.values_mut() {
            if entry.phase == PopupPhase::Closing
                || (entry.phase != PopupPhase::Adopted && entry.deadline <= now)
            {
                if entry.phase != PopupPhase::Closing {
                    self.sequence += 1;
                }
                failed |= Self::close_entry(entry).is_err();
            }
        }
        for (view, _, sent) in self.rejected.values_mut() {
            if !*sent {
                *sent = view.request_close().is_ok();
            }
            failed |= !*sent;
        }
        if failed {
            Err(PopupError::NativeCloseFailed)
        } else {
            Ok(())
        }
    }

    /// Only CEF OnBeforePopupAborted may acknowledge a cancelled pending create.
    pub fn creation_aborted(&mut self, id: &str) {
        if self.entries.get(id).is_some_and(|e| e.view.is_none()) {
            self.entries.remove(id);
            self.sequence += 1;
        }
    }

    /// CEF also acknowledges abandoned pending creation with the opener's
    /// OnBeforeClose; OnBeforePopupAborted is not guaranteed after destruction.
    /// Attached children still require their OWN OnBeforeClose acknowledgement.
    pub fn opener_closed(&mut self, opener_browser_id: i32) -> Vec<String> {
        let pending: Vec<_> = self
            .entries
            .iter()
            .filter(|(_, entry)| {
                entry.opener_browser_id == opener_browser_id && entry.view.is_none()
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &pending {
            self.creation_aborted(id);
        }
        pending
    }

    /// Only the actual child's OnBeforeClose callback may remove a live handle.
    pub fn before_close(&mut self, browser_id: i32) {
        let id = self.entries.iter().find_map(|(id, entry)| {
            entry
                .view
                .as_ref()
                .filter(|v| v.browser_id() == browser_id)
                .map(|_| id.clone())
        });
        if let Some(id) = id {
            self.entries.remove(&id);
            self.sequence += 1;
        }
        if self.rejected.remove(&browser_id).is_some() {
            self.sequence += 1;
        }
    }

    pub fn inventory(
        &self,
        window: &str,
        source: &PopupSourceIdentity,
    ) -> Result<PopupInventory, PopupError> {
        self.owner(window, source)?;
        // Closed inventories are useful to remove transient tabs. Do not emit
        // newly adoptable handles after the source lease is no longer current.
        if !self.source_closed {
            self.current()?;
        }
        Ok(PopupInventory {
            source_identity: self.source.clone(),
            sequence: self.sequence,
            source_closed: self.source_closed,
            views: self
                .entries
                .iter()
                .filter(|(_, e)| e.view.is_some())
                .map(|(id, e)| PopupViewInfo {
                    view_id: id.clone(),
                    disposition: e.disposition,
                    phase: e.phase,
                })
                .collect(),
        })
    }

    pub fn drained(&self) -> bool {
        self.source_closed && self.entries.is_empty() && self.rejected.is_empty()
    }
}
