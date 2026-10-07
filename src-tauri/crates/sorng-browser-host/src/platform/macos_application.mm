// CEF 154 / Tao 0.35.3 integration. Compile as Objective-C++ with ARC.
// Intentionally extends the existing TaoApp class: subclassing it would make
// Tao's dynamically resolved super(sendEvent:) recurse back into TaoApp.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include "include/cef_application_mac.h"

#include <cstring>
#include <cstdlib>
#include <dlfcn.h>
#include <initializer_list>
#include <new>

namespace {
Class bridged_class = Nil;
IMP original_send_event = nullptr;
BOOL handling_send_event = NO;  // All access is restricted to the AppKit thread.

void send_event(id application, SEL selector, NSEvent* event) {
  const BOOL previous = handling_send_event;
  handling_send_event = YES;
  @try {
    // Keep Tao's CMD-key-up forwarding and device-event dispatch intact.
    reinterpret_cast<void (*)(id, SEL, NSEvent*)>(original_send_event)(
        application, selector, event);
  } @finally {
    // Nested Cocoa loops and Objective-C exceptions both restore the prior
    // value. A simple YES/NO toggle loses an outer sendEvent scope.
    handling_send_event = previous;
  }
}

bool owns_method(Class cls, Method method) {
  unsigned count = 0;
  Method* methods = class_copyMethodList(cls, &count);
  bool found = false;
  for (unsigned i = 0; i < count; ++i) {
    found = found || methods[i] == method;
  }
  free(methods);
  return found;
}
}  // namespace

// This class supplies compiler-checked method ABIs, including BOOL differences
// on Intel and Apple Silicon. It is never used as the NSApplication singleton.
@interface SorngCefEventScopeMethods : NSObject <CefAppProtocol>
@end

@implementation SorngCefEventScopeMethods
- (BOOL)isHandlingSendEvent {
  return handling_send_event;
}
- (void)setHandlingSendEvent:(BOOL)value {
  handling_send_event = value;
}
@end

// Codes are mirrored in macos.rs. No exception may unwind into Rust.
extern "C" bool sorng_cef_is_main_thread() noexcept {
  return [NSThread isMainThread];
}

extern "C" int sorng_cef_install_tao_application_bridge() noexcept {
  @try {
    if (![NSThread isMainThread]) return 1;
    if (@available(macOS 14.0, *)) {
      // Supported; runtime check remains necessary for unpackaged probes.
    } else {
      return 2;
    }
    // NSApp is the global pointer, not sharedApplication (which could create
    // the wrong singleton before Tao's EventLoop constructor).
    if (NSApp == nil) return 3;
    Class cls = object_getClass(NSApp);
    if (std::strcmp(class_getName(cls), "TaoApp") != 0 ||
        class_getSuperclass(cls) != [NSApplication class]) return 4;

    const SEL send_selector = @selector(sendEvent:);
    Method send_method = class_getInstanceMethod(cls, send_selector);
    if (!send_method || !owns_method(cls, send_method)) return 5;
    if (bridged_class != Nil) {
      if (cls != bridged_class ||
          method_getImplementation(send_method) != reinterpret_cast<IMP>(send_event)) return 6;
      return [NSApp conformsToProtocol:@protocol(CefAppProtocol)] ? 0 : 6;
    }
    const SEL getter = @selector(isHandlingSendEvent);
    const SEL setter = @selector(setHandlingSendEvent:);
    // Fail closed on a competing bridge. Never overwrite unknown state.
    if (class_getInstanceMethod(cls, getter) || class_getInstanceMethod(cls, setter)) return 6;
    const Class donor = [SorngCefEventScopeMethods class];
    for (SEL selector : {getter, setter}) {
      Method method = class_getInstanceMethod(donor, selector);
      if (!class_addMethod(cls, selector, method_getImplementation(method),
                           method_getTypeEncoding(method))) return 7;
    }
    for (Protocol* protocol : {@protocol(CrAppProtocol), @protocol(CrAppControlProtocol),
                                @protocol(CefAppProtocol)}) {
      if (!class_conformsToProtocol(cls, protocol) && !class_addProtocol(cls, protocol)) return 7;
    }
    original_send_event = method_getImplementation(send_method);
    bridged_class = cls;
    method_setImplementation(send_method, reinterpret_cast<IMP>(send_event));
    return [NSApp conformsToProtocol:@protocol(CefAppProtocol)] ? 0 : 7;
  } @catch (NSException* exception) {
    (void)exception;
    return 8;
  }
}

// This check does not create NSApplication, send a synthetic event, or pump CEF.
extern "C" int sorng_cef_check_tao_application_bridge() noexcept {
  @try {
    if (![NSThread isMainThread]) return 1;
    if (!NSApp || !bridged_class) return 3;
    if (object_getClass(NSApp) != bridged_class) return 4;
    Method method = class_getInstanceMethod(bridged_class, @selector(sendEvent:));
    if (!method || method_getImplementation(method) != reinterpret_cast<IMP>(send_event) ||
        ![NSApp conformsToProtocol:@protocol(CefAppProtocol)]) return 6;
    return 0;
  } @catch (NSException* exception) {
    (void)exception;
    return 8;
  }
}

namespace {
using SandboxInitialize = void* (*)(int, char**);
using SandboxDestroy = void (*)(void*);
struct HelperSandbox {
  void* library;
  void* context;
  SandboxDestroy destroy;
};
}  // namespace

// Called in the helper before loading the CEF framework. No AppKit messages,
// NSApplication creation or Tauri startup are involved in helper initialization.
extern "C" void* sorng_cef_create_helper_sandbox(const char* library_path,
                                                 int argc, char** argv) noexcept {
  void* library = dlopen(library_path, RTLD_NOW | RTLD_LOCAL);
  if (!library) return nullptr;
  auto initialize = reinterpret_cast<SandboxInitialize>(dlsym(library, "cef_sandbox_initialize"));
  auto destroy = reinterpret_cast<SandboxDestroy>(dlsym(library, "cef_sandbox_destroy"));
  if (!initialize || !destroy) {
    dlclose(library);
    return nullptr;
  }
  auto sandbox = new (std::nothrow) HelperSandbox{library, nullptr, destroy};
  if (!sandbox) {
    dlclose(library);
    return nullptr;
  }
  sandbox->context = initialize(argc, argv);
  if (!sandbox->context) {
    dlclose(library);
    delete sandbox;
    return nullptr;
  }
  return sandbox;
}

extern "C" void sorng_cef_destroy_helper_sandbox(void* opaque) noexcept {
  auto sandbox = static_cast<HelperSandbox*>(opaque);
  if (!sandbox) return;
  sandbox->destroy(sandbox->context);
  dlclose(sandbox->library);
  delete sandbox;
}
