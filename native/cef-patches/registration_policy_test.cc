// Copyright 2026 The sorng Authors. BSD-3-Clause.
#include "registration_policy.h"
#include <cassert>
#include <cstdint>
#include <iostream>
#include <cstdlib>
#include <limits>
#include <string>
#include <vector>

namespace {
size_t g_cache_checks = 0;
void Check(bool condition, const char* what) {
  ++g_cache_checks;
  if (!condition) {
    std::cerr << "HTTP cache policy check failed: " << what << "\n";
    std::abort();
  }
}

bool Parses(const std::string& path, sorng_tls::PathStyle style) {
  sorng_tls::ParsedPath parsed;
  return sorng_tls::ParseAbsolutePath(path, style, parsed);
}

std::vector<size_t> Splits(const std::string& path, sorng_tls::PathStyle style) {
  sorng_tls::ParsedPath parsed;
  if (!sorng_tls::ParseAbsolutePath(path, style, parsed)) return {};
  return sorng_tls::HttpCacheRootSplits(parsed, style);
}

std::string Key(const std::string& root, const std::string& path,
                sorng_tls::PathStyle style) {
  sorng_tls::ParsedPath parsed;
  if (!sorng_tls::ParseAbsolutePath(path, style, parsed)) return {};
  const auto splits = sorng_tls::HttpCacheRootSplits(parsed, style);
  if (splits.empty()) return {};
  return sorng_tls::HttpCacheDirectoryKey(root, parsed, splits.front(), style);
}

size_t HttpCacheChecks() {
  using sorng_tls::PathStyle;
  constexpr auto kPosix = PathStyle::kPosix;
  constexpr auto kWin = PathStyle::kWindows;

  // max_bytes range [16 MiB, 1 GiB], inclusive; fits NetworkContext's int32.
  Check(!sorng_tls::HttpCacheSizeAllowed(0), "zero size");
  Check(!sorng_tls::HttpCacheSizeAllowed((16ull << 20) - 1), "below 16 MiB");
  Check(sorng_tls::HttpCacheSizeAllowed(16ull << 20), "16 MiB");
  Check(sorng_tls::HttpCacheSizeAllowed(128ull << 20), "128 MiB");
  Check(sorng_tls::HttpCacheSizeAllowed(1ull << 30), "1 GiB");
  Check(!sorng_tls::HttpCacheSizeAllowed((1ull << 30) + 1), "above 1 GiB");
  Check(!sorng_tls::HttpCacheSizeAllowed(UINT64_MAX), "u64 max");
  Check(sorng_tls::kMaxHttpCacheBytes <=
            static_cast<uint64_t>(std::numeric_limits<int32_t>::max()),
        "limit fits int32 http_cache_max_size");
  for (uint64_t bytes = (16ull << 20) - 4096; bytes <= (16ull << 20) + 4096; ++bytes)
    Check(sorng_tls::HttpCacheSizeAllowed(bytes) == (bytes >= (16ull << 20)),
          "lower boundary sweep");

  // Strict UTF-8.
  Check(sorng_tls::IsStrictUtf8(""), "empty utf8");
  Check(sorng_tls::IsStrictUtf8("abc"), "ascii");
  Check(sorng_tls::IsStrictUtf8("\xC3\xA9"), "2-byte");
  Check(sorng_tls::IsStrictUtf8("\xE2\x82\xAC"), "3-byte");
  Check(sorng_tls::IsStrictUtf8("\xF0\x9F\x98\x80"), "4-byte");
  Check(sorng_tls::IsStrictUtf8("\xF4\x8F\xBF\xBF"), "U+10FFFF");
  Check(!sorng_tls::IsStrictUtf8("\xC0\xAF"), "overlong slash");
  Check(!sorng_tls::IsStrictUtf8("\xE0\x80\xAF"), "overlong 3-byte");
  Check(!sorng_tls::IsStrictUtf8("\xF0\x80\x80\xAF"), "overlong 4-byte");
  Check(!sorng_tls::IsStrictUtf8("\xED\xA0\x80"), "surrogate");
  Check(!sorng_tls::IsStrictUtf8("\xF4\x90\x80\x80"), "above U+10FFFF");
  Check(!sorng_tls::IsStrictUtf8("\xC3"), "truncated");
  Check(!sorng_tls::IsStrictUtf8("\xE2\x82"), "truncated 3-byte");
  Check(!sorng_tls::IsStrictUtf8("\x80"), "lone continuation");
  Check(!sorng_tls::IsStrictUtf8("\xFF"), "invalid lead");
  for (unsigned lead = 0x80; lead <= 0xFF; ++lead) {
    const std::string lone(1, static_cast<char>(lead));
    Check(!sorng_tls::IsStrictUtf8(lone), "lone non-ASCII byte");
  }

  // POSIX lexical paths.
  Check(Parses("/", kPosix), "posix root");
  Check(Parses("/home/u/.local/share/app/http-cache/a/b", kPosix), "posix ok");
  Check(Parses("/home/u/.config", kPosix), "dot-prefixed name is not '.'");
  Check(!Parses("", kPosix), "posix empty");
  Check(!Parses("relative/http-cache/a", kPosix), "posix relative");
  Check(!Parses("/a/../http-cache/b", kPosix), "posix dotdot");
  Check(!Parses("/a/./http-cache/b", kPosix), "posix dot");
  Check(!Parses("/a//http-cache/b", kPosix), "posix empty component");
  Check(!Parses("/a/http-cache/b/", kPosix), "posix trailing separator");
  Check(!Parses(std::string("/a/http-cache/b\0c", 17), kPosix), "posix NUL");
  Check(!Parses("/a/http-cache/b\nc", kPosix), "posix control");
  Check(!Parses("/a/http-cache/b\x7f", kPosix), "posix DEL");
  Check(!Parses("/a/http-cache/\xC0\xAF", kPosix), "posix overlong");
  Check(Parses("/a\\b/http-cache/c", kPosix), "posix backslash is a name byte");
  Check(!Parses("/" + std::string(sorng_tls::kMaxHttpCachePathBytes, 'a'), kPosix),
        "posix too long");
  Check(Parses("/" + std::string(sorng_tls::kMaxHttpCachePathBytes - 1, 'a'), kPosix),
        "posix at the length limit");

  // Windows lexical paths: drive-absolute only.
  Check(Parses("C:\\", kWin), "win drive root");
  Check(Parses("C:\\Users\\u\\AppData\\Local\\app\\http-cache\\a\\b", kWin), "win ok");
  Check(Parses("c:/Users/u/http-cache/a", kWin), "win forward slashes");
  Check(!Parses("C:", kWin), "win drive only");
  Check(!Parses("C:http-cache\\a", kWin), "win drive-relative");
  Check(!Parses("\\Users\\http-cache\\a", kWin), "win rooted no drive");
  Check(!Parses("\\\\server\\share\\http-cache\\a", kWin), "win UNC");
  Check(!Parses("\\\\?\\C:\\http-cache\\a", kWin), "win device namespace");
  Check(!Parses("\\\\.\\C:\\http-cache\\a", kWin), "win device path");
  Check(!Parses("1:\\http-cache\\a", kWin), "win non-letter drive");
  Check(!Parses("C:\\a\\..\\http-cache\\b", kWin), "win dotdot");
  Check(!Parses("C:\\a\\.\\http-cache\\b", kWin), "win dot");
  Check(!Parses("C:\\a\\\\http-cache\\b", kWin), "win empty component");
  Check(!Parses("C:\\a/\\http-cache\\b", kWin), "win mixed empty component");
  Check(!Parses("C:\\a\\http-cache\\b\\", kWin), "win trailing separator");
  Check(!Parses("C:\\a\\http-cache\\b:stream", kWin), "win alternate data stream");
  for (const char* bad : {"<", ">", "\"", "|", "?", "*"}) {
    Check(!Parses(std::string("C:\\a\\http-cache\\b") + bad, kWin), "win reserved char");
  }
  Check(!Parses("C:\\a\\http-cache\\b.", kWin), "win trailing dot");
  Check(!Parses("C:\\a\\http-cache\\b ", kWin), "win trailing space");
  Check(!Parses("C:\\a\\http-cache\\..b.", kWin), "win dotted trailing dot");
  Check(Parses("C:\\a\\http-cache\\.b", kWin), "win leading dot allowed");
  Check(Parses("C:\\PROGRA~1\\http-cache\\b", kWin), "win short name in root parses");

  // Strict descendant of <root>/http-cache/.
  Check(Splits("/r/http-cache", kPosix).empty(), "http-cache itself is not a descendant");
  Check(Splits("/r/http-cache/a", kPosix) == std::vector<size_t>{1}, "posix split");
  Check(Splits("/r/x/http-cache/a/b", kPosix) == std::vector<size_t>{2}, "posix deep split");
  Check(Splits("/r/HTTP-CACHE/a", kPosix).empty(), "posix is case-sensitive");
  Check(Splits("/r/http-cache/x/http-cache/y", kPosix) == std::vector<size_t>({1, 3}),
        "posix every candidate split");
  Check(Splits("/r/http-cachex/a", kPosix).empty(), "posix exact component");
  Check(Splits("C:\\r\\HTTP-Cache\\a", kWin) == std::vector<size_t>{1}, "win case-insensitive");
  Check(Splits("C:\\r\\http-cache\\DEADBE~1\\a", kWin).empty(), "win short name below");
  Check(Splits("C:\\r\\http-cache\\a\\b~c", kWin).empty(), "win tilde below");
  Check(Splits("C:\\MARIAN~1\\r\\http-cache\\a", kWin) == std::vector<size_t>{2},
        "win short name in root is allowed");
  Check(Splits("/r/http-cache/a~b", kPosix) == std::vector<size_t>{1},
        "posix tilde is a plain name byte");

  // Canonical identity and the identical/nested holder check.
  const std::string a = Key("/root", "/root/http-cache/db/conn", kPosix);
  Check(a == "/root/http-cache/db/conn", "posix key");
  Check(Key("/root/", "/root/http-cache/db/conn", kPosix) == a, "root trailing separator");
  Check(Key("C:\\Root", "c:/root/HTTP-CACHE/DB/Conn", kWin) == "c:/root/http-cache/db/conn",
        "win key folds case and separators");
  Check(Key("C:\\Root", "C:\\Root\\http-cache\\db\\conn", kWin) ==
            Key("c:\\root", "c:/ROOT/http-cache/DB/CONN", kWin),
        "win spellings share one key");
  Check(Key("/Root", "/Root/http-cache/DB", kPosix) != Key("/Root", "/Root/http-cache/db", kPosix),
        "posix keys stay case-sensitive");
  const auto overlap = sorng_tls::HttpCacheDirectoriesOverlap;
  Check(overlap(a, a), "identical overlaps");
  Check(overlap("/root/http-cache/db", a), "ancestor overlaps");
  Check(overlap(a, "/root/http-cache/db"), "descendant overlaps");
  Check(overlap(a, a + "/net"), "nested child overlaps");
  Check(!overlap(a, "/root/http-cache/db/conn2"), "sibling with shared prefix");
  Check(!overlap(a, "/root/http-cache/db/con"), "shorter sibling");
  Check(!overlap("/root/http-cache/db/a", "/root/http-cache/db/b"), "siblings");
  Check(!overlap("/root/http-cache/db1/a", "/root/http-cache/db2/a"), "other database");

  // One-shot hold: non-cache registrations never report state 7.
  sorng_tls::HttpCacheHold none(false);
  Check(!none.requested() && !none.CanGrant(false) && !none.Grant(1), "none never grants");
  Check(!none.Revoked() && !none.ReceiverDisconnected(1), "none never releases");
  Check(!none.TakeReleaseReport() && none.Settled() && !none.HoldsDirectory(), "none settled");

  // Revoked before any NetworkContext: released at revocation, reported once.
  sorng_tls::HttpCacheHold early(true);
  Check(early.requested() && early.HoldsDirectory() && !early.Settled(), "available holds");
  Check(early.CanGrant(false) && !early.CanGrant(true), "no grant after revoke");
  Check(early.Revoked(), "ungranted release");
  Check(!early.Revoked(), "revoke releases once");
  Check(!early.HoldsDirectory() && !early.CanGrant(false) && !early.Grant(2),
        "released never re-grants");
  Check(!early.Settled(), "unsettled until reported");
  Check(early.TakeReleaseReport() && !early.TakeReleaseReport(), "one state 7");
  Check(!early.Settled(), "unsettled while callback runs");
  early.ReleaseReportReturned();
  Check(early.Settled(), "settled after callback returns");

  // Granted: only the holder's disconnect releases; revocation waits for it.
  sorng_tls::HttpCacheHold held(true);
  Check(held.Grant(7) && !held.Grant(8) && !held.CanGrant(false), "single grant");
  Check(held.HoldsDirectory(), "granted holds");
  Check(!held.Revoked(), "revocation does not release a live NetworkContext");
  Check(!held.ReceiverDisconnected(8), "other receiver does not release");
  Check(!held.TakeReleaseReport() && !held.Settled(), "no report before release");
  Check(held.ReceiverDisconnected(7), "holder disconnect releases");
  Check(!held.ReceiverDisconnected(7), "duplicate disconnect");
  Check(!held.HoldsDirectory() && !held.Grant(9), "released never re-grants");
  Check(held.TakeReleaseReport() && !held.TakeReleaseReport(), "exactly one state 7");
  held.ReleaseReportReturned();
  Check(held.Settled(), "settled");
  sorng_tls::HttpCacheHold untaken(true);
  untaken.ReleaseReportReturned();
  Check(!untaken.Settled(), "returning without a report cannot settle");

  // Retirement needs BOTH state 2 and state 7 (any order).
  for (int order = 0; order < 2; ++order) {
    sorng_tls::RegistrationLifetime life;
    sorng_tls::HttpCacheHold hold(true);
    life.Attach();
    Check(hold.Grant(1), "grant");
    life.Detach();
    if (order == 0) {
      life.TerminalCallbackReturned();  // State 2 first.
      Check(!life.CanRetire(true, hold.Settled()), "2 without 7 keeps registration");
      Check(life.CanRetire(true), "legacy overload ignores cache");
      Check(hold.ReceiverDisconnected(1) && hold.TakeReleaseReport(), "7 after 2");
      {
        sorng_tls::RegistrationCallbackScope scope(life);
        hold.ReleaseReportReturned();
        Check(!life.CanRetire(true, hold.Settled()), "not while 7 callback is on the stack");
      }
      Check(life.CanRetire(true, hold.Settled()), "retire after 2 then 7");
    } else {
      Check(hold.ReceiverDisconnected(1) && hold.TakeReleaseReport(), "7 before 2");
      hold.ReleaseReportReturned();
      Check(!life.CanRetire(true, hold.Settled()), "7 without 2 keeps registration");
      life.TerminalCallbackReturned();
      Check(!life.CanRetire(false, hold.Settled()), "controls still gate");
      Check(life.CanRetire(true, hold.Settled()), "retire after 7 then 2");
    }
  }
  // NULL factory: callbacks quiescent, but a granted directory stays held.
  sorng_tls::RegistrationLifetime abandoned;
  sorng_tls::HttpCacheHold abandoned_hold(true);
  Check(abandoned_hold.Grant(3), "partial factory grant");
  abandoned.Abandon();
  Check(!abandoned_hold.Revoked(), "abandon cannot release a granted directory");
  Check(!abandoned.CanRetire(true, abandoned_hold.Settled()), "held after NULL");
  Check(abandoned_hold.ReceiverDisconnected(3) && abandoned_hold.TakeReleaseReport(),
        "quiescent release");
  abandoned_hold.ReleaseReportReturned();
  Check(abandoned.CanRetire(true, abandoned_hold.Settled()), "retired after release");
  return g_cache_checks;
}
}  // namespace

int main() {
  sorng_tls::TokenHighWater tokens;
  for (uint64_t token = 1; token <= 10000; ++token) {
    assert(tokens.Reserve(token, token, 0));
    assert(!tokens.Reserve(token, token, 0));
    assert(!tokens.Reserve(token, token + 1, 0));
    assert(!tokens.Reserve(token - 1, token, 0));
  }
  assert(!tokens.Reserve(10001, 1, sorng_tls::kMaxLiveRegistrations));
  assert(tokens.maximum() == 10000);
  assert(tokens.Reserve(10001, 1, sorng_tls::kMaxLiveRegistrations - 1));
  assert(!tokens.Reserve(10002, 0, 0));
  assert(tokens.Reserve(std::numeric_limits<uint64_t>::max(), 1, 0));
  assert(!tokens.Reserve(0, 1, 0));
  assert(!tokens.Reserve(1, 1, 0));

  sorng_tls::RegistrationLifetime life;
  sorng_tls::ControlRevocations controls;
  life.Attach();
  const auto first = controls.Add();
  const auto second = controls.Add();
  assert(!controls.Acknowledge(first));
  assert(!life.CanRetire(controls.AllSettled()));
  controls.RequestAll();
  assert(controls.TakeRevoke(first));
  assert(!controls.TakeRevoke(first));
  assert(controls.TakeRevoke(second));
  assert(controls.Disconnect(first));
  assert(!controls.Acknowledge(first));
  assert(controls.Acknowledge(second));
  assert(!controls.Disconnect(second));
  assert(controls.AllSettled());
  // ACK completion alone never erases an attached revoked context.
  life.TerminalCallbackReturned();
  assert(!life.CanRetire(controls.AllSettled()));
  life.Detach();
  assert(life.CanRetire(controls.AllSettled()));
  // A Ready queued before retirement temporarily prevents retirement again.
  const auto late = controls.Add();
  assert(!life.CanRetire(controls.AllSettled()));
  assert(controls.TakeRevoke(late));
  assert(controls.Acknowledge(late));
  assert(life.CanRetire(controls.AllSettled()));

  sorng_tls::RegistrationLifetime detached_first;
  detached_first.Attach();
  detached_first.Detach();
  assert(!detached_first.CanRetire(true));
  detached_first.TerminalCallbackReturned();
  assert(detached_first.CanRetire(true));

  sorng_tls::RegistrationLifetime nested_callbacks;
  nested_callbacks.Attach();
  {
    sorng_tls::RegistrationCallbackScope outer(nested_callbacks);
    nested_callbacks.Detach();
    {
      sorng_tls::RegistrationCallbackScope terminal(nested_callbacks);
      assert(!nested_callbacks.CanRetire(true));
    }
    nested_callbacks.TerminalCallbackReturned();
    // Even a nested UI pump cannot retire while the enclosing Ready/failure
    // or evidence callback is still on the stack.
    assert(!nested_callbacks.CanRetire(true));
  }
  assert(nested_callbacks.CanRetire(true));

  sorng_tls::RegistrationLifetime failed_factory;
  failed_factory.Abandon();
  assert(failed_factory.callbacks_quiescent());
  assert(!failed_factory.CanRetire(false));
  assert(failed_factory.CanRetire(true));
  sorng_tls::RegistrationLifetime partial_factory;
  partial_factory.Attach();
  partial_factory.Abandon();
  assert(!partial_factory.CanRetire(true));
  partial_factory.Detach();
  assert(partial_factory.CanRetire(true));

  sorng_tls::ControlRevocations capped;
  for (size_t i = 0; i < sorng_tls::kMaxRegistrationControls; ++i) assert(capped.Add());
  assert(!capped.Add());
  assert(!capped.Disconnect(0));
  assert(!capped.Acknowledge(UINT64_MAX));
  std::cout << "registration policy: 10000 sequential identities and lifecycle/control boundaries passed\n";
  const size_t cache_checks = HttpCacheChecks();
  std::cout << "registration policy: revision 6 HTTP cache checks passed: "
            << cache_checks << "\n";
}
