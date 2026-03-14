# TeamStore Boundary

`TeamStore` should remain an orchestration facade, not a database sink.

Its responsibilities:
- Apply workflow and automation policy decisions.
- Compose multiple repositories into a single research-facing API.
- Expose derived reads such as claim summaries and budget anomaly snapshots.

It should not directly own table-specific persistence once a clear repository boundary exists.

Repository responsibilities:
- Persist and load one table family or one tightly related persistence concern.
- Avoid workflow policy, approval gating, and cross-entity coordination logic.

Current target end state:
- `TeamStore`: orchestration and derived reads.
- `*Store` modules: persistence per concern.
- Policy transitions remain explicit in `TeamStore` or a later service layer.
