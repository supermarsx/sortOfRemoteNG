#import <AppKit/AppKit.h>

// Plain-text write for the native browser menu's "Copy ... address" rows.
// General pasteboard, write-only. The text is a page-supplied address: it is
// never logged, and failure is reported only as false.
extern "C" bool sorng_cef_clipboard_write_text(const char* utf8, size_t length) {
  if (!utf8 || length == 0 || length > 16384 || ![NSThread isMainThread]) return false;
  @autoreleasepool {
    @try {
      NSString* text = [[NSString alloc] initWithBytes:utf8
                                                length:length
                                              encoding:NSUTF8StringEncoding];
      if (!text) return false;
      NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
      [pasteboard clearContents];
      return [pasteboard setString:text forType:NSPasteboardTypeString];
    } @catch (NSException*) {
      return false;
    }
  }
}
