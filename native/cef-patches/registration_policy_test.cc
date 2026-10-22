// Copyright 2026 The sorng Authors. BSD-3-Clause.
#include "registration_policy.h"
#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>

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
}
