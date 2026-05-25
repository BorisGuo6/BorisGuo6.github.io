# Triage Labels

Use the default Matt Pocock triage roles when an external issue tracker is introduced:

- `needs-triage`: maintainer needs to evaluate.
- `needs-info`: waiting on reporter.
- `ready-for-agent`: fully specified and safe for an agent to pick up.
- `ready-for-human`: requires human implementation or judgment.
- `wontfix`: will not be actioned.

For dashboard-native TODOs, map these to task status where possible:

- `needs-triage` -> `review`
- `needs-info` -> `needs_user`
- `ready-for-agent` -> `todo`
- `ready-for-human` -> `blocked`
- `wontfix` -> archive/delete only after user confirmation
