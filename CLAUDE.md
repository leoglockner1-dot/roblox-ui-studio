# CLAUDE.md — working on Roblox UI Studio

Read first: `obsidian/ROBLOX UI STUDIO/ARCHITECTURE.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`,
and the newest file in `obsidian/ROBLOX UI STUDIO/development_logs/`.

## Rules
- Every document mutation is an op (`src/core/ops.ts`) with an inverse. Never mutate documents directly.
- Roblox classes/properties/enums/defaults are defined ONLY in `src/core/classes.ts`.
- Layout is computed by `src/core/layout.ts`, never by CSS. The renderer only paints.
- Tools live in `src/server/tools.ts` and serve both MCP and HTTP. After changing tools run `npm run docs:api`.
- Format changes need a migration in `src/core/migrate.ts` and a version bump.
- Keep `src/core` free of DOM and Node APIs.

## Commands
- `npm test` (vitest), `npm run test:e2e` (Playwright), `npm run typecheck`
- `npm run build && npm start` (port 5178), `npm run dev`
- Workspace override: `RUIS_WORKSPACE=/path`

## After a session
Update CHANGELOG.md, DEVELOPMENT_ROADMAP.md, KNOWN_ISSUES.md and add `development_logs/<date>.md`
in `obsidian/ROBLOX UI STUDIO/`.
