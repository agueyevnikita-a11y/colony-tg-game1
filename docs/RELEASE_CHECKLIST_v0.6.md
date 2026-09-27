# Release checklist v0.6

- [x] Migration 006 added to schema and migrations folder.
- [x] City Score calculated server-side.
- [x] Premium/Stars/cosmetics excluded from City Score.
- [x] Decor cannot overlap buildings or other decor.
- [x] Building placement/move cannot overlap decor.
- [x] Alliance daily goal reward requires personal contribution.
- [x] Owner/officer permissions enforced server-side.
- [x] Project cycle restart protected by role, completion state and cooldown.
- [x] Concurrent restart protected by row locking + unique cycle index.
- [x] 50 TS/TSX files syntax-transpiled successfully.
- [ ] npm install + full `npm run typecheck` in deployment environment.
- [ ] `npm run build` in deployment environment.
- [ ] Apply migrations against staging PostgreSQL and run API smoke test.
