//! Pure, bounded correlation for CEF 154 find feedback. Search text is private.
//!
//! CEF 682c378 delegates to Chromium 154.0.8037.58 FindTabHelper. Its identifiers
//! are process-wide, NOT predictable per browser. StopFinding followed by Find
//! starts a new session whose replies exclude all earlier sessions. Within one
//! session we issue at most one request until its final reply, then require a
//! strictly newer native identifier. Callers MUST apply `restart` before Find.
//! Sources: chromiumembedded/cef@682c378 libcef/browser/browser_host_base.cc;
//! chromium/chromium@154.0.8037.58 components/find_in_page/find_tab_helper.cc.

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFindResult {
    pub request_id: String,
    pub active_match_ordinal: i32,
    pub number_of_matches: i32,
    pub final_update: bool,
}

pub fn valid_request_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

// No Debug implementation: neither queries nor completion closures are logs.
pub struct Request<T> {
    pub request_id: String,
    pub text: zeroize::Zeroizing<String>,
    pub forward: bool,
    pub match_case: bool,
    pub find_next: bool,
    pub completion: T,
}

pub struct Dispatch {
    pub restart: bool,
    pub text: zeroize::Zeroizing<String>,
    pub forward: bool,
    pub match_case: bool,
}

struct Active<T> {
    request: Request<T>,
    native_id: Option<i32>,
    floor: i32,
    final_update: bool,
}

pub struct FindState<T> {
    active: Option<Active<T>>,
    queued: Option<Request<T>>,
    high_water: i32,
}

impl<T> Default for FindState<T> {
    fn default() -> Self {
        Self {
            active: None,
            queued: None,
            high_water: -1,
        }
    }
}

impl<T: Clone> FindState<T> {
    pub fn submit(&mut self, request: Request<T>) -> Option<Dispatch> {
        let continuing = request.find_next
            && self.active.as_ref().is_some_and(|active| {
                active.request.text == request.text
                    && active.request.match_case == request.match_case
            });
        if continuing
            && self
                .active
                .as_ref()
                .is_some_and(|active| !active.final_update)
        {
            // One bounded latest intent; no unbounded keyboard-repeat queue.
            self.queued = Some(request);
            return None;
        }
        self.queued = None;
        let dispatch = Dispatch {
            restart: !continuing,
            text: request.text.clone(),
            forward: request.forward,
            match_case: request.match_case,
        };
        self.active = Some(Active {
            request,
            native_id: None,
            floor: self.high_water,
            final_update: false,
        });
        Some(dispatch)
    }

    pub fn reply(
        &mut self,
        identifier: i32,
        count: i32,
        ordinal: i32,
        final_update: i32,
    ) -> Option<(T, NativeFindResult)> {
        if identifier < 0 || !matches!(final_update, 0 | 1) {
            return None;
        }
        let active = self.active.as_mut()?;
        if active.final_update
            || identifier <= active.floor
            || active.native_id.is_some_and(|id| id != identifier)
        {
            return None;
        }
        active.native_id = Some(identifier);
        self.high_water = self.high_water.max(identifier);
        active.final_update = final_update == 1;
        // CEF may initially report -1 (not known). Never manufacture a zero.
        if count < 0 || ordinal < 0 || ordinal > count {
            return None;
        }
        // A queued request supersedes this UI receipt, but we still drain the
        // native final reply before dispatching its next/previous operation.
        if self.queued.is_some() {
            return None;
        }
        Some((
            active.request.completion.clone(),
            NativeFindResult {
                request_id: active.request.request_id.clone(),
                active_match_ordinal: ordinal,
                number_of_matches: count,
                final_update: final_update == 1,
            },
        ))
    }

    pub fn ready(&self) -> bool {
        self.active
            .as_ref()
            .is_some_and(|active| active.final_update)
            && self.queued.is_some()
    }

    pub fn advance(&mut self) -> Option<Dispatch> {
        if !self.ready() {
            return None;
        }
        let request = self.queued.take()?;
        self.submit(request)
    }

    pub fn clear(&mut self) {
        self.active = None;
        self.queued = None;
        // Keep the native ID floor across stop/navigation (no ABA).
    }

    pub fn expire(&mut self) -> bool {
        if self
            .active
            .as_ref()
            .is_some_and(|active| !active.final_update)
        {
            self.clear();
            true
        } else {
            false
        }
    }
}
