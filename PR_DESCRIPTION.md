## Summary

- Add Android native app support aligned with the PWA, including session controls, file/plan tabs, and scheduled messages.
- Integrate Notion-backed repo discovery and selected-repo development context.
- Move mobile/PWA/backend connectivity to a Tailscale URL and load `NOTION_TOKEN` from `backend/.env`.

## Details

- Backend
  - Loads `backend/.env` before configuration and Notion sync.
  - Syncs Notion projects into SQLite on startup.
  - Adds `POST /projects/sync-notion`.
  - Adds `GET /projects/:projectId/context` for one selected repo's Notion notes, next steps, git status, and recent commits.
  - Adds scheduled-message API support for session follow-ups.

- Android
  - Adds React Native Android app scaffold and native permissions.
  - Defaults setup to the Tailscale backend URL.
  - Adds project/session navigation, session terminal/files/plan views, and scheduling controls.
  - Shows repo context only after selecting a specific repo.

- PWA
  - Defaults setup to the Tailscale backend URL.
  - Shows selected-repo context in project detail.
  - Adds scheduled-message controls.

## Verification

- `cd backend && npm run build`
- `cd frontend && npm run build`
- `cd android && npm run ts`
- Live Android emulator smoke test against `http://100.117.114.128:3742`
- Notion sync verified with 25 projects loaded from the configured table
- Selected-repo context verified for `spell_engine`

## Notes

- `backend/.env` is intentionally ignored. Use `backend/.env.example` as the template.
- This folder is not currently a Git working tree, so no branch/commit was created locally.
