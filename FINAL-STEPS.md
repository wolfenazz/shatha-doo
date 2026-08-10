# NEXT STEPS — Finish the Dynamics 365 Connector (v1.1.0)

**Builder:** Shatha Ebrahem · **Date:** 2026-08-04 · **Updated:** 2026-08-10
**Status:** Code complete ✅ (v1.1.0) · **Offline proof** ✅ (`npm run demo`, 110 tests) · **Step 5 (deploy) DONE** ✅ · **Remaining:** Steps 1–4 (live sandbox, blocked on Microsoft 365 tenant + Azure AD), Step 6 (submit), Step 7 (final check)

---

## TL;DR — What's left

| # | Task | Status | Effort |
|---|------|--------|--------|
| 1 | Provision a Dynamics 365 trial sandbox | ⏸ on hold (no Microsoft 365 tenant / Azure AD available) | 30–60 min |
| 2 | Register an Azure app + grant permissions | ⏸ on hold (needs the sandbox tenant) | 20–30 min |
| 3 | Configure `.env` and run `testConnection` | ⏸ on hold | 10 min |
| 4 | Run one real create-contact flow | ⏸ on hold (closes DoD #9) | 15 min |
| 5 | Deploy the MCP endpoint to HTTPS | ✅ **DONE** — `https://shatha-doo-production.up.railway.app` | 30–60 min |
| 6 | Submit to the DOO validation console | ▶ **do this now** — ZIP + MCP URL + blocker note (see `docs/SUBMISSION.md`) | 15 min |
| 7 | Do the final DoD self-check & demo | ▶ after Step 6 | 20 min |

> **v1.1.0 (2026-08-10):** OAuth is now wired into the connector core (token
> acquisition + refresh + cache), `testConnection` runs a real WhoAmI probe,
> retry-with-backoff honors `Retry-After`, CI + coverage gates were added, and a
> **bundled mock sandbox** (`npm run demo`) proves the whole stack end-to-end
> offline — 7/7 checks. See `docs/CHANGELOG.md` and `docs/SUBMISSION.md`.

Everything else (5 actions, auth code, errors, schemas, OpenAPI, MCP adapter, unit +
integration tests, CI, docs, tags `v1.0.0` + `v1.1.0`) is **done and green** — 110/110 tests pass.

---

## Step 1 — Provision a Dynamics 365 sandbox (the main blocker)

> This is the **only real blocker**. The code is 100% verified offline with mocks; now it needs a real tenant.

**Option A — 30-day Dynamics 365 trial (recommended)**
1. Go to https://dynamics.microsoft.com/en-us/dynamics-365-free-trial/
2. Sign up with a Microsoft account (can be a new free account — no credit card needed).
3. Pick a product that includes Sales (e.g., **Dynamics 365 Sales** trial) so contacts, leads, and tasks exist.
4. After signup you get an environment URL like: `https://org<id>.crm.dynamics.com`

**Option B — Power Apps developer plan (free, no credit card)**
1. Go to https://powerapps.microsoft.com/en-us/developerplan/
2. Create a developer environment — it also gives you a Dataverse environment that speaks the **same Web API** (v9.2) this connector uses.
3. Your environment URL will look like `https://org<id>.crm.dynamics.com`.

> 💡 Write down your **Environment URL** — you'll need it for `.env` (`D365_ORG_URL`).

**Verify it works first (before touching code):**
```bash
# From PowerShell — this should return your user info (proves the org is live)
# (You'll do this via the connector itself in Step 4 — this is just a sanity check)
```

---

## Step 2 — Register an Azure app + grant permissions

> Do this in the SAME tenant as your trial. Full walkthrough: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/walkthrough-register-app-azure-active-directory

1. Open the **Azure portal** → https://portal.azure.com (sign in with the same account as your trial).
2. Go to **Microsoft Entra ID** → **App registrations** → **New registration**.
3. Name it `dynamics365-connector` → select **Accounts in this organizational directory only (Single tenant)** → **Register**.
4. From the app's **Overview** page, copy:
   - **Application (client) ID** → `D365_CLIENT_ID`
   - **Directory (tenant) ID** → `D365_TENANT_ID`
5. **Certificates & secrets** → **New client secret** → copy the **Value now** (shown only once!) → `D365_CLIENT_SECRET`
6. **Authentication** → **Add a platform** → **Web** → Redirect URI: `http://localhost:3000/callback` (must match `.env` exactly).
7. **API permissions** → **Add a permission** → **Dynamics CRM** → **Delegated permissions** → check **`user_impersonation`** → **Add permissions**.
8. Click **Grant admin consent for <your tenant>** → **Yes** (required, or you'll get `AADSTS65001`).

> ⚠️ Security rules: never commit `.env`, never paste the secret into chat/logs, never screenshot it.

---

## Step 3 — Configure `.env` and install

```bash
# From the project folder
npm install
Copy-Item .env.example .env        # PowerShell
# or:  cp .env.example .env         # Bash
```

Edit `.env` and fill in:

```env
D365_ORG_URL=https://<your-org>.api.crm.dynamics.com   # from Step 1
D365_TENANT_ID=<azure-tenant-id>                       # from Step 2
D365_CLIENT_ID=<azure-app-client-id>                   # from Step 2
D365_CLIENT_SECRET=<azure-app-client-secret>           # from Step 2
D365_REDIRECT_URI=http://localhost:3000/callback       # must match Azure
D365_API_VERSION=v9.2
D365_LOG_LEVEL=info
```

> 💡 Keep `D365_ACCESS_TOKEN=` empty for now — the OAuth flow will fill it.

---

## Step 4 — Run `testConnection` + one real create flow

**Build first:**
```bash
npm run build
```

**Prove authentication works (no side effects — calls `WhoAmI()`):**
```bash
node -e "
const { Dynamics365Connector } = require('./dist/src/connector');
const c = new Dynamics365Connector();
c.testConnection({
  orgUrl: process.env.D365_ORG_URL,
  tenantId: process.env.D365_TENANT_ID,
  clientId: process.env.D365_CLIENT_ID,
  clientSecret: process.env.D365_CLIENT_SECRET,
  redirectUri: process.env.D365_REDIRECT_URI
}).then(r => console.log(JSON.stringify(r, null, 2)));
"
```
Expected: `{ "success": true, ... }` → **auth is working.**

**Create a real contact (the sandbox proof for DoD #9):**
```bash
node -e "
const { Dynamics365Connector } = require('./dist/src/connector');
const c = new Dynamics365Connector();
c.execute({
  actionId: 'dynamics.create_contact',
  input: { firstname: 'Shatha', lastname: 'Test', emailaddress1: 'shatha.test@example.com' },
  credentials: { orgUrl: process.env.D365_ORG_URL, tenantId: process.env.D365_TENANT_ID,
                 clientId: process.env.D365_CLIENT_ID, clientSecret: process.env.D365_CLIENT_SECRET,
                 redirectUri: process.env.D365_REDIRECT_URI }
}).then(r => console.log(JSON.stringify(r, null, 2)));
"
```
Expected: `{ success: true, data: { contactid: "...", ... } }` → **action works end-to-end.**

Then try the other four:
- `dynamics.search_contact` (search for the contact you just made)
- `dynamics.update_contact` (change its phone)
- `dynamics.create_lead`
- `dynamics.create_task`

---

## Step 5 — Deploy the MCP endpoint to HTTPS ✅ DONE (2026-08-05)

> **Live endpoint:** `https://shatha-doo-production.up.railway.app` — verified over HTTPS with an MCP client: initialize OK, all 5 tools listed, clean `[MISSING_ORG_URL]` errors (expected until the sandbox is ready).

**How it was done:** Railway (`railway up` from the project folder) with the `Procfile` (`web: npm run build && node dist/mcp/http-server.js`). Two fixes were required along the way:
1. The server must run the **HTTP transport** (`mcp/http-server.ts`, `npm run mcp:http`) — the stdio server has no HTTP surface.
2. `mcp/http-server.ts` shims `globalThis.crypto` — the MCP SDK's bare `crypto.randomUUID()` throws `ReferenceError` on Node 18 at request time (verified on 18.20.8).

**Ops notes:**
- `PORT` is set to `3000` as a Railway variable; the public domain targets port 3000.
- Redeploy after code changes: `railway up` (auto-deploy is off in this project).
- Placeholder env vars are fine until Steps 1–4 complete; swap them in the Variables tab later.

**Choose ONE platform (pick the easiest you already use):**

**A) Railway (very easy)**
1. Push this repo to GitHub (already done: `origin` → your repo).
2. New project → **Deploy from GitHub repo** → Railway auto-detects.
3. Add the `.env` variables from Step 3 in the project's **Variables** tab (placeholders are fine until the sandbox is ready).
4. Start command: `npm run build && node dist/mcp/http-server.js`
5. Railway gives you a public URL — that's your **MCP URL** for the console.

> ⚠️ Use the **HTTP transport** (`mcp/http-server.ts`, via `npm run mcp:http`) for deployment — the stdio server (`npm run mcp`) has no HTTP surface, so a public URL on it alone would fail console checks. `mcp/http-server.ts` serves the same tools over MCP Streamable HTTP on `$PORT`.

**B) Vercel**
```bash
npm i -g vercel
vercel --prod
```
- Add env vars in the Vercel dashboard (Settings → Environment Variables).
- Note: Vercel serverless works best for HTTP; the stdio MCP adapter may need a custom server — Railway/Fly.io is simpler for MCP.

**C) Fly.io (good for long-running MCP)**
```bash
fly launch
fly secrets set D365_ORG_URL=... D365_TENANT_ID=... D365_CLIENT_ID=... D365_CLIENT_SECRET=...
fly deploy
```

> ⚠️ The MCP server currently reads `D365_ORG_URL` + `D365_ACCESS_TOKEN` from the environment (non-interactive). For an interactive OAuth flow inside MCP, that's future work — documented in `docs/HANDOFF.md`.

---

## Step 6 — Submit to the DOO validation console

> **Ready to submit now:** MCP URL = `https://shatha-doo-production.up.railway.app` + the codebase ZIP (rebuild it to include the HTTP transport).
> **Include the blocker note** from `docs/SUBMISSION.md` — the organizers confirmed the code can be
> submitted as-is: mention that it was **not tested live because no Microsoft 365 tenant and Azure AD
> environment is available**, which are required for the final validation.

1. Go to https://built2.doo.ooo/console
2. Sign in with your **@doo.ooo** email (secure-link sign-in, no password).
3. Enter your deployed HTTPS MCP endpoint URL from Step 5.
4. Use a **temporary bearer token** if the console asks for auth.
5. Run the validation: **contract checks, schema checks, safety checks**.
6. Copy the **result slug** and save it — this is your official validation link.

---

## Step 7 — Final Definition-of-Done self-check

Tick every box — all are done EXCEPT the sandbox/deploy ones you just completed:

- [x] Manifest identifies provider, version, auth type, scopes, actions, risks, capabilities
- [x] testConnection verifies credentials (shape + real WhoAmI probe when a token source exists)
- [x] All 5 actions work through the shared execute interface
- [x] Every action has typed JSON Schema inputs, outputs, and examples
- [x] Errors normalized with request IDs + retry classification
- [x] Pagination + rate-limit metadata returned where relevant
- [x] Write actions document approval, idempotency, duplicates, retry
- [x] No secrets in code, Git history, logs, fixtures, screenshots
- [x] Unit + integration + MCP tests pass (110/110); offline demo 7/7 (`npm run demo`)
- [ ] **One real sandbox flow proven** ← blocked: no Microsoft 365 tenant / Azure AD available
- [x] OpenAPI + MCP adapter reuse the same connector core
- [x] Known limitations documented
- [x] Release tagged v1.1.0 with handoff + submission notes

**Then prepare your demo (5 min) — works offline with the mock sandbox:**
1. `npm run demo` → testConnection WhoAmI probe succeeds.
2. Create + search a contact, update its phone.
3. Create a lead and a task.
4. Show the validation slug from Step 6.

---

## Cheat-sheet of commands

```bash
npm install                 # install deps
npm run typecheck           # tsc --noEmit  (EXIT=0)
npm run build               # compile to dist/ (EXIT=0)
npm test                    # 7 suites / 110 tests (EXIT=0)
npm run test:coverage       # + coverage gate (≥80% stmts/lines/funcs, ≥70% branches)
npm run lint                # eslint (EXIT=0)
npm run demo                # offline end-to-end demo vs mock sandbox (7/7 checks)
npm run mcp                 # run MCP stdio server locally
npm run mcp:http            # run MCP Streamable HTTP server locally (deploy this)
node dist/mcp/server.js     # same as above
node dist/mcp/http-server.js
```

## Useful links

- Dynamics 365 trial: https://dynamics.microsoft.com/en-us/dynamics-365-free-trial/
- Power Apps developer plan: https://powerapps.microsoft.com/en-us/developerplan/
- Azure app registration guide: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/walkthrough-register-app-azure-active-directory
- Web API overview: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview
- DOO validation console: https://built2.doo.ooo/console
- Handoff notes (what was delivered): `docs/HANDOFF.md`

---

*Good luck, Shatha! 🚀 The hard part (the connector itself) is done — Steps 1–2 unlock the real-world proof, Steps 5–6 ship it.*
