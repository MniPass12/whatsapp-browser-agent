# WhatsApp Browser Agent Runner

This repository hosts the ephemeral Playwright/Patchright Chromium runner used by a personal Cloudflare Workers browser assistant.

## Security Model
- No credentials, database IDs, user IDs, or Worker URLs are stored in this repository.
- All communication between this GitHub Actions runner and the control Worker uses masked repository secrets (`INTERNAL_CALLBACK_SECRET` and `WORKER_BASE_URL`) over authenticated HTTPS Bearer requests.
- Dispatched workflow payloads contain only an opaque `session_id` and `mode`.
