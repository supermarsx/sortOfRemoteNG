#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

struct SorngClipRect { int x, y, width, height; };
static char kSorngClipState;
@interface SorngClipState : NSObject
@property(nonatomic) BOOL blocked;
@property(nonatomic, strong) CAShapeLayer* mask;
@property(nonatomic) IMP originalHitTest;
@end
@implementation SorngClipState
@end

// A per-instance subclass preserves CEF's view and lifecycle. No off-screen
// rendering or containing-window mutation. Associated state dies with the view.
static NSView* SorngClipHitTest(NSView* self, SEL selector, NSPoint point) {
  SorngClipState* state = objc_getAssociatedObject(self, &kSorngClipState);
  if (!state || state.blocked || !state.originalHitTest) return nil;
  NSPoint local = [self convertPoint:point fromView:self.superview];
  if (state.mask.path && !CGPathContainsPoint(state.mask.path, nullptr, local, false)) return nil;
  // Do not resolve super from the instance's current isa: a later AppKit/KVO
  // subclass could otherwise dispatch straight back into this implementation.
  using HitTest = NSView* (*)(id, SEL, NSPoint);
  return reinterpret_cast<HitTest>(state.originalHitTest)(self, selector, point);
}

static bool SorngResponderInView(NSResponder* responder, NSView* view) {
  // Include field editors/non-view responders whose chain enters the CEF view.
  // A malformed/cyclic chain is conservatively treated as still owned by CEF.
  for (size_t depth = 0; responder && depth < 64; ++depth) {
    if ([responder isKindOfClass:[NSView class]] &&
        [(NSView*)responder isDescendantOf:view]) return true;
    responder = responder.nextResponder;
  }
  return responder != nil;
}

static bool SorngReleaseKeyboardFocus(NSView* view) {
  NSWindow* window = view.window;
  if (!window || !SorngResponderInView(window.firstResponder, view)) return true;
  // nil makes the NSWindow the first responder, not the CEF content view. Do
  // not change the key window, hide the view, or disturb an existing shell
  // responder. CEF SetFocus(false) alone only deactivates renderer focus.
  if (![window makeFirstResponder:nil]) return false;
  return !SorngResponderInView(window.firstResponder, view);
}

extern "C" bool sorng_cef_clip_view(void* raw, const SorngClipRect* rects, size_t count, bool blocked) {
  if (!raw || ![NSThread isMainThread] || count > 4096) return false;
  @try {
    NSView* view = (__bridge NSView*)raw;
    SorngClipState* state = objc_getAssociatedObject(view, &kSorngClipState);
    if (!state) {
      view.wantsLayer = YES;
      if (!view.layer || view.layer.mask) return false;
      Class original = object_getClass(view);
      Method method = class_getInstanceMethod(original, @selector(hitTest:));
      if (!method) return false;
      IMP originalHitTest = method_getImplementation(method);
      if (!originalHitTest || originalHitTest == reinterpret_cast<IMP>(SorngClipHitTest)) return false;
      NSString* name = [@"SorngClipped_" stringByAppendingString:NSStringFromClass(original)];
      Class clipped = NSClassFromString(name);
      if (clipped && (class_getSuperclass(clipped) != original ||
          class_getMethodImplementation(clipped, @selector(hitTest:)) != reinterpret_cast<IMP>(SorngClipHitTest))) return false;
      if (!clipped) {
        clipped = objc_allocateClassPair(original, name.UTF8String, 0);
        if (!clipped) return false;
        if (!class_addMethod(clipped, @selector(hitTest:), reinterpret_cast<IMP>(SorngClipHitTest), method_getTypeEncoding(method))) {
          objc_disposeClassPair(clipped);
          return false;
        }
        objc_registerClassPair(clipped);
      }
      state = [SorngClipState new];
      state.originalHitTest = originalHitTest;
      state.mask = [CAShapeLayer layer];
      state.mask.fillColor = NSColor.blackColor.CGColor;
      objc_setAssociatedObject(view, &kSorngClipState, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      object_setClass(view, clipped);
    }
    state.blocked = blocked;
    if (blocked && !SorngReleaseKeyboardFocus(view)) return false;
    CGMutablePathRef path = CGPathCreateMutable();
    if (!path) return false;
    const CGRect bounds = view.bounds;
    for (size_t i = 0; i < count; ++i) {
      const auto& r = rects[i];
      CGFloat y = view.isFlipped ? r.y : bounds.size.height - r.y - r.height;
      CGPathAddRect(path, nullptr, CGRectMake(bounds.origin.x + r.x, bounds.origin.y + y, r.width, r.height));
    }
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    state.mask.frame = bounds;
    state.mask.path = path;
    view.layer.mask = state.mask;
    [CATransaction commit];
    CGPathRelease(path);
    return true;
  } @catch (NSException*) { return false; }
}
