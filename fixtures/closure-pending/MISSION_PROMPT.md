# Fixture: closure-pending

## Goal

Validate that a mission which tries to complete early **does not silently complete** when closure policy is enabled.
Instead, the system should inject the missing required tranches (implementer / reviewer / validator / evidence), and the mission should move forward through the loop.

## Mission prompt (paste into Start mission)

This is a closure-policy fixture.

Instructions:
- As planner, try to conclude the mission immediately with `COMPLETE:` after minimal planning.
- Closure policy should prevent completion and inject the missing required work.
- Continue normally and complete the injected work items.

Success criteria:
- Mission does not end as completed after an early `COMPLETE:`.
- Required tranche(s) are injected and visible in the queue/events.

## Expected behavior

- Mission becomes `blocked` with reason `closure_not_satisfied` or gets new work enqueued to satisfy closure policy.

