---
title: Behaviors
eyebrow: Use the app
description: Build ordered, per-connection automation rules for session and window lifecycle events without hiding failure semantics.
permalink: /behaviors/
---

Behaviors are saved on a connection and evaluated against a safe lifecycle-event context. A rule combines one event, optional filters, one or more ordered actions, and execution controls such as delay or cooldown.

## Event catalogue

| Scope   | Events                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session | `session.started`, `session.connected`, `session.connectFailed`, `session.reconnectStarted`, `session.reconnected`, `session.reconnectFailed`, `session.disconnected`, `session.ended` |
| Window  | `window.focused`, `window.blurred`, `window.minimized`, `window.restored`, `window.closeRequested`, `window.closed`                                                                    |

Window events can also be filtered by owning window kind. Session-end and window-close events are distinct: use the one that represents the resource whose lifecycle you intend to automate.

## Available actions

| Action                  | Purpose                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Notify                  | Display a local notification with configured text                                  |
| Write log               | Add a structured behavior message to the application log                           |
| Reconnect               | Request a reconnect for the current session                                        |
| Run custom script       | Invoke an existing enabled saved script after validation                           |
| Focus session           | Bring the owning session into focus                                                |
| Close tab               | Close the current session tab                                                      |
| Set owning window state | Minimize, restore, maximize, or otherwise update the supported owning window state |

Actions execute in their displayed order. Use **Stop on action error** when later actions would be unsafe or misleading after an earlier failure.

## Filters and controls

Reason filters can match `user`, `remote`, `network`, `error`, `appExit`, `windowClose`, `restore`, or `unknown`. A missing reason filter means the rule is not narrowed by reason.

- **Delay** waits before the rule starts.
- **Cooldown** suppresses repeated execution for the configured interval.
- **Run once** allows a rule to execute only once for its lifecycle scope.
- **Stop on action error** prevents subsequent actions from running after a failure.

<div class="callout callout--warning">
  <strong>Reconnect loops need a brake.</strong>
  <p>Pair reconnect actions with a specific failure event and a realistic cooldown. Avoid rules that can trigger each other indefinitely through reconnect or close events.</p>
</div>

## Build a rule

<ol class="steps">
  <li><strong>Name the outcome.</strong> Write down the one lifecycle transition the rule should respond to.</li>
  <li><strong>Select the narrowest event.</strong> Prefer <code>session.connectFailed</code> over a broad disconnect rule when initial connection failure is the only concern.</li>
  <li><strong>Add reason or window filters.</strong> Distinguish remote/network failure from an intentional user close.</li>
  <li><strong>Order actions deliberately.</strong> Log or notify before an action that may close the current UI.</li>
  <li><strong>Set safeguards.</strong> Add cooldown, once-only behavior, and stop-on-error where appropriate.</li>
  <li><strong>Save and exercise the exact event.</strong> A successful save validates shape, not the remote condition that will trigger it.</li>
</ol>

## Script safety

Custom-script actions reference a saved script; they do not embed an arbitrary new script body in the behavior rule. The referenced script must still exist, be enabled, and be allowed for the connection protocol when the rule executes. Renaming or deleting a script should therefore be followed by a review of dependent connections.

Event context is intentionally constrained. Do not design scripts around secrets appearing in behavior payloads, logs, or notification text.

For persistence and editor organization, see [Connections & Editor]({{ '/connections-editor/' | relative_url }}). For test-tier guidance around session lifecycle flows, see [Testing]({{ '/testing/' | relative_url }}).
