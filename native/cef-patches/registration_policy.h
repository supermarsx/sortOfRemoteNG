// Copyright 2026 The sorng Authors. BSD-3-Clause.
// Shared by the actual CEF registration bridge and its standalone unit test.
#ifndef SORNG_TLS_REGISTRATION_POLICY_H_
#define SORNG_TLS_REGISTRATION_POLICY_H_

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace sorng_tls {
inline constexpr size_t kMaxLiveRegistrations = 1024;
inline constexpr size_t kMaxRegistrationControls = 64;

class TokenHighWater {
 public:
  bool Reserve(uint64_t token, uint64_t generation, size_t live_count) {
    if (!token || !generation || token <= maximum_ ||
        live_count >= kMaxLiveRegistrations)
      return false;
    maximum_ = token;
    return true;
  }
  uint64_t maximum() const { return maximum_; }

 private:
  uint64_t maximum_ = 0;
};

class RegistrationLifetime {
 public:
  void Attach() { attached_ = true; }
  void Detach() { attached_ = false; released_ = true; }
  // A failed factory may not call the application after returning NULL. If it
  // partially attached a context, retain its denying delegate until Detach.
  void Abandon() { released_ = true; callbacks_quiescent_ = true; }
  void TerminalCallbackReturned() { terminal_callback_returned_ = true; }
  bool callbacks_quiescent() const { return callbacks_quiescent_; }
  bool CanRetire(bool all_controls_settled) const {
    return CanRetire(all_controls_settled, true);
  }
  // Revision 6: a disk-cache registration also stays until HttpCacheHold is
  // settled, so its directory remains held while any NetworkContext owns it.
  bool CanRetire(bool all_controls_settled, bool http_cache_settled) const {
    return released_ && !attached_ && callback_depth_ == 0 && all_controls_settled &&
           http_cache_settled &&
           (terminal_callback_returned_ || callbacks_quiescent_);
  }

 private:
  friend class RegistrationCallbackScope;
  size_t callback_depth_ = 0;
  bool attached_ = false;
  bool released_ = false;
  bool terminal_callback_returned_ = false;
  bool callbacks_quiescent_ = false;
};

class RegistrationCallbackScope {
 public:
  explicit RegistrationCallbackScope(RegistrationLifetime& lifetime)
      : lifetime_(lifetime) { ++lifetime_.callback_depth_; }
  ~RegistrationCallbackScope() { --lifetime_.callback_depth_; }
  RegistrationCallbackScope(const RegistrationCallbackScope&) = delete;
  RegistrationCallbackScope& operator=(const RegistrationCallbackScope&) = delete;
 private:
  RegistrationLifetime& lifetime_;
};

// IDs are stable slot+1 values, never reused within a registration. A control
// disconnect and its queued revoke callback may both arrive: settle once.
class ControlRevocations {
 public:
  uint64_t Add() {
    if (used_ == controls_.size()) return 0;
    controls_[used_].requested = revoking_;
    return ++used_;
  }
  void RequestAll() {
    revoking_ = true;
    for (size_t i = 0; i < used_; ++i) controls_[i].requested = true;
  }
  bool TakeRevoke(uint64_t id) {
    auto* control = Find(id);
    if (!control || !control->requested || control->settled || control->sent)
      return false;
    control->sent = true;
    return true;
  }
  bool Acknowledge(uint64_t id) {
    auto* control = Find(id);
    return control && control->requested && control->sent && Settle(control);
  }
  bool Disconnect(uint64_t id) { return Settle(Find(id)); }
  bool AllSettled() const {
    if (!revoking_) return false;
    for (size_t i = 0; i < used_; ++i)
      if (!controls_[i].settled) return false;
    return true;
  }

 private:
  struct Control { bool requested = false; bool sent = false; bool settled = false; };
  Control* Find(uint64_t id) {
    return id && id <= used_ ? &controls_[static_cast<size_t>(id - 1)] : nullptr;
  }
  static bool Settle(Control* control) {
    if (!control || control->settled) return false;
    control->settled = true;
    return true;
  }
  bool revoking_ = false;
  size_t used_ = 0;
  std::array<Control, kMaxRegistrationControls> controls_{};
};

// Revision 6: HTTP disk cache directory policy.
inline constexpr uint64_t kMinHttpCacheBytes = uint64_t{16} << 20;
inline constexpr uint64_t kMaxHttpCacheBytes = uint64_t{1} << 30;
inline constexpr size_t kMaxHttpCachePathBytes = 4096;
inline constexpr std::string_view kHttpCacheDirectoryName = "http-cache";
inline constexpr bool HttpCacheSizeAllowed(uint64_t bytes) {
  return bytes >= kMinHttpCacheBytes && bytes <= kMaxHttpCacheBytes;
}

enum class PathStyle { kPosix, kWindows };
#if defined(_WIN32)
inline constexpr PathStyle kNativePathStyle = PathStyle::kWindows;
#else
inline constexpr PathStyle kNativePathStyle = PathStyle::kPosix;
#endif

// Strict UTF-8: no overlong forms, surrogates or code points above U+10FFFF.
inline bool IsStrictUtf8(std::string_view text) {
  size_t i = 0;
  while (i < text.size()) {
    const auto lead = static_cast<unsigned char>(text[i]);
    if (lead < 0x80) {
      ++i;
      continue;
    }
    size_t extra = 0;
    uint32_t code = 0;
    uint32_t minimum = 0;
    if (lead >= 0xC2 && lead <= 0xDF) {
      extra = 1; code = lead & 0x1F; minimum = 0x80;
    } else if (lead >= 0xE0 && lead <= 0xEF) {
      extra = 2; code = lead & 0x0F; minimum = 0x800;
    } else if (lead >= 0xF0 && lead <= 0xF4) {
      extra = 3; code = lead & 0x07; minimum = 0x10000;
    } else {
      return false;
    }
    if (text.size() - i <= extra) return false;
    for (size_t k = 1; k <= extra; ++k) {
      const auto next = static_cast<unsigned char>(text[i + k]);
      if ((next & 0xC0) != 0x80) return false;
      code = (code << 6) | (next & 0x3F);
    }
    if (code < minimum || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF))
      return false;
    i += extra + 1;
  }
  return true;
}

inline char FoldAscii(char c) {
  return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c;
}
inline bool SameComponent(std::string_view a, std::string_view b, PathStyle style) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (style == PathStyle::kWindows ? FoldAscii(a[i]) != FoldAscii(b[i]) : a[i] != b[i])
      return false;
  }
  return true;
}

// Lexically valid absolute path. POSIX: "/a/b". Windows: drive-absolute only
// ("C:\a\b" or "C:/a/b"); UNC, device and drive-relative paths are rejected.
// No empty, "." or ".." component and no control character anywhere. Windows
// components also reject <>:"|?* and a trailing dot or space (Win32 strips
// them).
struct ParsedPath {
  std::string drive;  // "C:" on Windows; empty on POSIX.
  std::vector<std::string> components;
  std::string Join(size_t count, PathStyle style) const {
    const char separator = style == PathStyle::kWindows ? '\\' : '/';
    std::string result = drive;
    result.push_back(separator);
    for (size_t i = 0; i < count && i < components.size(); ++i) {
      if (i) result.push_back(separator);
      result += components[i];
    }
    return result;
  }
};
inline bool ParseAbsolutePath(std::string_view path, PathStyle style, ParsedPath& out) {
  out = ParsedPath();
  if (path.empty() || path.size() > kMaxHttpCachePathBytes || !IsStrictUtf8(path))
    return false;
  for (const char c : path) {
    const auto byte = static_cast<unsigned char>(c);
    if (byte < 0x20 || byte == 0x7F) return false;
  }
  const auto separator = [style](char c) {
    return c == '/' || (style == PathStyle::kWindows && c == '\\');
  };
  size_t start = 0;
  if (style == PathStyle::kWindows) {
    const char letter = FoldAscii(path[0]);
    if (path.size() < 3 || letter < 'a' || letter > 'z' || path[1] != ':' ||
        !separator(path[2]))
      return false;
    out.drive = std::string(1, static_cast<char>(letter - 'a' + 'A')) + ":";
    start = 3;
  } else {
    if (path[0] != '/') return false;
    start = 1;
  }
  if (start == path.size()) return true;  // Filesystem root.
  while (true) {
    size_t end = start;
    while (end < path.size() && !separator(path[end])) ++end;
    const std::string_view component = path.substr(start, end - start);
    if (component.empty() || component == "." || component == "..") return false;
    if (style == PathStyle::kWindows) {
      if (component.find_first_of("<>:\"|?*") != std::string_view::npos ||
          component.back() == '.' || component.back() == ' ')
        return false;
    }
    out.components.emplace_back(component);
    if (end == path.size()) return true;
    start = end + 1;
    if (start == path.size()) return false;  // Trailing separator.
  }
}

// Candidate root-prefix lengths: component `index` is "http-cache" and at least
// one component follows it (strict descendant). The bridge accepts the first
// candidate whose prefix is the actual CefSettings.root_cache_path. On Windows
// no component below http-cache may contain '~': 8.3 short-name aliases would
// defeat the identical/nested directory check. The root itself may.
inline std::vector<size_t> HttpCacheRootSplits(const ParsedPath& path, PathStyle style) {
  std::vector<size_t> result;
  for (size_t index = 0; index + 1 < path.components.size(); ++index) {
    if (!SameComponent(path.components[index], kHttpCacheDirectoryName, style))
      continue;
    bool aliasable = false;
    for (size_t below = index + 1; below < path.components.size(); ++below) {
      aliasable = aliasable || (style == PathStyle::kWindows &&
                                path.components[below].find('~') != std::string::npos);
    }
    if (!aliasable) result.push_back(index);
  }
  return result;
}

// Canonical identity used to detect nested or identical cache directories:
// '/' separators, root without trailing separators, ASCII-folded on Windows.
inline std::string HttpCacheDirectoryKey(std::string_view root_utf8,
                                         const ParsedPath& path, size_t split,
                                         PathStyle style) {
  std::string key(root_utf8);
  for (char& c : key) {
    if (style == PathStyle::kWindows) {
      if (c == '\\') c = '/';
      c = FoldAscii(c);
    }
  }
  while (!key.empty() && key.back() == '/') key.pop_back();
  for (size_t i = split; i < path.components.size(); ++i) {
    key.push_back('/');
    for (char c : path.components[i])
      key.push_back(style == PathStyle::kWindows ? FoldAscii(c) : c);
  }
  return key;
}
inline bool HttpCacheDirectoriesOverlap(std::string_view a, std::string_view b) {
  const auto nested = [](std::string_view outer, std::string_view inner) {
    return inner.size() > outer.size() && inner.substr(0, outer.size()) == outer &&
           inner[outer.size()] == '/';
  };
  return a == b || nested(a, b) || nested(b, a);
}

// One-shot directory hold of a disk-cache registration (state 7 source).
// Available: validated, no NetworkContext yet. Granted: exactly one client
// receiver's NetworkContext owns the directory. Released: that receiver
// disconnected, or revocation happened before any grant. Never re-granted.
class HttpCacheHold {
 public:
  explicit HttpCacheHold(bool requested)
      : state_(requested ? State::kAvailable : State::kNone) {}
  bool requested() const { return state_ != State::kNone; }
  bool CanGrant(bool revoked) const { return state_ == State::kAvailable && !revoked; }
  bool Grant(uint64_t receiver_id) {
    if (state_ != State::kAvailable) return false;
    state_ = State::kGranted;
    holder_ = receiver_id;
    return true;
  }
  // Returns true exactly when this disconnect releases the directory.
  bool ReceiverDisconnected(uint64_t receiver_id) {
    if (state_ != State::kGranted || holder_ != receiver_id) return false;
    state_ = State::kReleased;
    return true;
  }
  // Revocation forbids future grants; an ungranted hold is released now.
  bool Revoked() {
    if (state_ != State::kAvailable) return false;
    state_ = State::kReleased;
    return true;
  }
  bool HoldsDirectory() const {
    return state_ == State::kAvailable || state_ == State::kGranted;
  }
  // State 7 is reported once, after release; never for a non-cache registration.
  bool TakeReleaseReport() {
    if (state_ != State::kReleased || report_taken_) return false;
    report_taken_ = true;
    return true;
  }
  void ReleaseReportReturned() { report_returned_ = report_taken_; }
  bool Settled() const {
    return state_ == State::kNone || (state_ == State::kReleased && report_returned_);
  }

 private:
  enum class State { kNone, kAvailable, kGranted, kReleased };
  State state_;
  uint64_t holder_ = 0;
  bool report_taken_ = false;
  bool report_returned_ = false;
};
}  // namespace sorng_tls
#endif
