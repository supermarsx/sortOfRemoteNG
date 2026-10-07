// Executable tests of the exact policy predicate compiled into the engine.
// This does NOT substitute for Chromium TLS/Mojo/CEF integration tests.
#include "sorng_tls_policy.h"
#include <stdio.h>
#include <stdlib.h>
static unsigned checks;
static void check(bool condition) {
  ++checks;
  if (!condition) { fprintf(stderr, "policy assertion %u failed\n", checks); abort(); }
}
int main() {
  using sorng_tls::Admit;
  using sorng_tls::ExceptionMask;
  check(Admit(true, 0, 0, false, 1, 0));
  check(!Admit(true, 0, 0, false, 0, 0));
  check(!Admit(true, 0, 0, false, 2, 0));
  check(!Admit(true, 0, 4, false, 1, 0));
  for (int error = -1000; error <= 1; ++error) {
    for (uint32_t mask = 0; mask <= 15; ++mask) {
      const bool possible = (error == -200 || error == -201 || error == -202) &&
                            mask > 0 && mask <= 7;
      check((ExceptionMask(error, mask, false) != 0) == possible);
      for (uint32_t reply = 0; reply <= 15; ++reply) {
        check(Admit(true, error, mask, false, 2, reply) == (possible && reply == mask));
        check(!Admit(false, error, mask, false, 2, reply));
        check(!Admit(true, error, mask, true, 2, reply));
      }
    }
  }
  // Every unknown/error bit defeats a partial name/date/authority exception.
  for (unsigned bit = 3; bit < 32; ++bit) {
    const uint32_t status = 4u | (1u << bit);
    const bool metadata = !(sorng_tls::kAllCertErrors & (1u << bit));
    check(Admit(true, -202, status, false, 2, 4) == metadata);
  }
  // Normal native CA success still needs independent app consent.
  check(!Admit(true, 0, 0, false, 99, 0));
  check(!Admit(true, -202, 4, false, 1, 0));
  check(Admit(true, -202, 4, false, 2, 4));
  check(!Admit(true, -202, 7, false, 2, 4));
  check(Admit(true, -202, 7, false, 2, 7));
  printf("PASS %u engine policy checks\n", checks);
}
