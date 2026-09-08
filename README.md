# Dynamics 365 Connector

A production-oriented **Microsoft Dynamics 365 connector** for the DOO Builders League,
built to the shared `DooConnector` standard. It wraps the Dynamics 365 (Dataverse) Web API
v9.2 as an independent, reusable TypeScript package with **five typed actions**, safe
OAuth 2.0 authentication, normalized errors, unit + integration tests, an OpenAPI 3.1
spec, a thin MCP adapter, CI, and an **offline demo** that proves the whole stack
without a tenant.

> **Builder:** Shatha Ebrahem · Cohort 01 · Aug–Sep 2026
> **Provider:** Microsoft Dynamics 365 (Web API v9.2) · **Category:** Enterprise CRM
> **Version:** v1.1.0

---

## The Five Actions

| # | Action ID | Type | Approval | Description |
|---|-----------|------|----------|-------------|
| 1 | `dynamics.search_contact` | read | — | Search contacts by full name (OData `contains`) |
| 2 | `dynamics.create_contact` | write | required | Create a new contact record |
| 3 | `dynamics.update_contact` | write | required | Update an existing contact (PATCH, idempotent) |
| 4 | `dynamics.create_lead` | write | required | Create a new lead record |
| 5 | `dynamics.create_task` | write | required | Create a new task record |

Write actions are **consequential**: they modify production data, so they are flagged
`approval: required` in `connector.yaml` and are **not idempotent / not retry-safe**
(except `update_contact`, which uses idempotent PATCH semantics). Deduplicate by
searching before creating.

---

## Repository Structure

```
dynamics365-connector/
├── docs/
│   ├── connector.yaml            # Manifest: provider, auth, actions, capabilities, risks
│   ├── openapi.yaml              # OpenAPI 3.1.x specification (one path per action)
│   ├── SUBMISSION.md             # Paste-ready submission note (tenant-blocker statement)
│   ├── CHANGELOG.md / HANDOFF.md / requirements.md / todo.md
│   └── research/                 # API/endpoints/auth/limits research (S1.1.x)
├── src/
│   ├── connector.ts              # Dynamics365Connector core (DooConnector contract)
│   ├── client.ts                 # Web API client: axios + OData headers + interceptors + retry
│   ├── auth/index.ts             # OAuth 2.0 authorization_code + refresh_token
│   ├── actions/                  # 5 action modules (definition + handler + validation)
│   ├── schemas/index.ts          # JSON Schema 2020-12 input/output definitions (T1.2)
│   ├── errors/index.ts           # ConnectorError + normalizeDynamicsError + retry flags
│   └── types.ts                  # Shared DooConnector contracts
├── mcp/
│   ├── server.ts                 # Thin MCP adapter (tools -> connector.execute, env credentials)
│   └── http-server.ts            # HTTP MCP adapter (Streamable HTTP, deployment entry point)
├── tests/
│   ├── sandbox/dynamics-sandbox.ts  # Mock Dynamics 365 sandbox (OAuth + Web API v9.2)
│   ├── integration.test.ts          # Real connector + MCP vs the sandbox over HTTP
│   ├── *.test.ts                    # Unit tests (client, connector, actions, errors, auth, mcp)
│   └── fixtures/                    # Mock records + responses
├── scripts/demo.ts               # Offline end-to-end demo (npm run demo)
├── examples/                     # Usage examples for each action (compiled to dist/examples)
├── .github/workflows/ci.yml      # CI: typecheck, lint, test, build, audit, secret scan
├── Procfile                      # Deploy start command (web: build + http-server)
├── .env.example                  # Environment template (no secrets committed)
└── README.md
```

---

## Installation

Requires **Node.js >= 18** (developed on Node v24).

```bash
# From the package root
npm install

# Type-check (tsc --noEmit)
npm run typecheck

# Build to dist/
npm run build

# Run tests (Jest + ts-jest: unit + integration)
npm test

# Coverage gate (≥80% statements/lines/functions, ≥70% branches)
npm run test:coverage

# Lint & format
npm run lint
npm run format
```

### Offline demo (no tenant required)

```bash
npm run demo
```

Boots the bundled **mock Dynamics 365 sandbox** (simulates the Dataverse Web API
v9.2 + the Microsoft identity v2.0 token endpoint) and drives the **real**
production path — OAuth → connector core → MCP tools — printing a pass/fail
report for all five actions:

```
PASS  testConnection (WhoAmI probe)   38 ms   userId=00000000-...
PASS  MCP initialize + tools/list     12 ms   5 tools (...)
PASS  dynamics.create_contact         13 ms   contactid=6a9b9eca-...
PASS  dynamics.search_contact         12 ms   1 result(s)
PASS  dynamics.update_contact         18 ms   contactid=... updated
PASS  dynamics.create_lead             6 ms   leadid=...
PASS  dynamics.create_task             5 ms   activityid=...
Result: 7/7 checks passed
```

This is the same code that talks to a real org once `D365_ORG_URL` + Azure
credentials are provided — it proves the stack end-to-end while the
Microsoft 365 tenant / Azure AD environment is unavailable.

---

## Configuration

Copy `.env.example` to `.env` and fill in your Dynamics 365 / Microsoft Entra values:

```env
D365_ORG_URL=https://<your-org>.api.crm.dynamics.com
D365_TENANT_ID=<azure-tenant-id>
D365_CLIENT_ID=<azure-app-client-id>
D365_CLIENT_SECRET=<azure-app-client-secret>
D365_REDIRECT_URI=http://localhost:3000/callback
D365_API_VERSION=v9.2        # optional
D365_LOG_LEVEL=info          # optional
D365_WRITE_APPROVAL_TOKEN=<random-write-approval-secret>
MCP_API_KEY=<random-http-api-key>
MCP_ALLOWED_ORIGINS=https://trusted-client.example.com
```

**Azure app registration** needs these delegated permissions (see
`docs/research/permissions-limits-blockers.md` for the full walkthrough):

- `Dynamics CRM.UserBasic`
- `Dynamics CRM.Organization.Read`
- `Dynamics CRM.Organization.Write`

> Security: **never commit `.env`**. Only the `.env.example` template is tracked.

---

## Usage

### As a library (DooConnector core)

```typescript
import { Dynamics365Connector } from './src/connector';

const connector = new Dynamics365Connector();

// List the five registered actions (each carries its JSON Schema + examples)
const actions = connector.listActions();

// Execute any action through the shared core
const result = await connector.execute({
  actionId: 'dynamics.search_contact',
  input: { query: 'John', top: 10 },
  credentials: {
    orgUrl: 'https://<org>.api.crm.dynamics.com',
    accessToken: '<token>', // or OAuth client fields; token from src/auth
  },
});

// Consequential writes additionally require a token issued by the trusted
// approval host after the user approves that exact operation:
await connector.execute({
  actionId: 'dynamics.create_contact',
  input: { firstname: 'Jane' },
  credentials: { orgUrl: 'https://<org>.api.crm.dynamics.com', accessToken: '<token>' },
  metadata: { approvalToken: process.env.D365_WRITE_APPROVAL_TOKEN },
});

if (result.success) {
  console.log(result.data); // { contacts, count, nextLink? }
} else {
  console.error(result.error); // ConnectorError { code, message, requestId, retryable }
}

// Verify credentials: shape validation first, then a real WhoAmI() probe
// whenever a token source is provided (result in details.probe).
const check = await connector.testConnection({
  orgUrl: '...',
  accessToken: '...', // or the OAuth client fields (tenantId/clientId/clientSecret)
});
```

### Per-action examples

Run any example after `npm run build`:

```bash
node dist/examples/search-contact.js
node dist/examples/create-contact.js
node dist/examples/update-contact.js
node dist/examples/create-lead.js
node dist/examples/create-task.js
```

### MCP adapter

**Stdio (local/embedded use):**

```bash
node dist/mcp/server.js        # or: npm run mcp
```

**Streamable HTTP (deployment — what a public MCP endpoint must run):**

```bash
node dist/mcp/http-server.js   # or: npm run mcp:http   (listens on $PORT, default 3000)
```

Both expose all five actions as MCP tools (`dynamics.search_contact`, ...) and are
**thin adapters only** — every tool call forwards to the shared `connector.execute()` core
(no duplicated provider or business logic).

**Credentials:** the MCP adapter reads `D365_*` variables from the environment
(`D365_ORG_URL`, `D365_ACCESS_TOKEN`, or the OAuth client fields
`D365_TENANT_ID`/`D365_CLIENT_ID`/`D365_CLIENT_SECRET` plus `D365_REFRESH_TOKEN`
or `D365_AUTH_CODE`) and forwards them with every tool call — see `.env.example`.
Write tools require `_approvalToken`; it is removed before provider validation and
verified against `D365_WRITE_APPROVAL_TOKEN` in constant time.

**Deploying to HTTPS (e.g., Railway):**

```
web: npm run build && node dist/mcp/http-server.js
```

The `Procfile` ships this as the start command. The HTTP transport serves the same server
instance over MCP Streamable HTTP (`GET`/`POST`/`DELETE`), so a deployed container answers
`initialize`, `tools/list`, and `tools/call` from any MCP client. Note: `mcp/http-server.ts`
shims `globalThis.crypto`, because the MCP SDK references the global `crypto` object and
that bare reference fails on some Node 18 runtimes.
The HTTP endpoint rejects anonymous requests unless `Authorization: Bearer <MCP_API_KEY>`
matches, rate-limits callers by IP, and emits CORS headers only for origins explicitly
listed in `MCP_ALLOWED_ORIGINS`.

---

## Reliability & Error Handling

- **Normalized errors** — every failure is a `ConnectorError` with a machine-readable
  `code`, secret-safe `message`, the provider `requestId` (from `x-ms-request-id`), and a
  `retryable` classification (see `src/errors/index.ts`).
- **Safe automatic retry** — retryable GET and idempotent PATCH failures (429 / 5xx /
  network) are retried with
  exponential backoff (default 2 attempts, `maxRetries` configurable). `Retry-After` is
  honored when present (`retryAfterMs` on the error); the backoff is capped by default.
  POST creates and DELETE requests are never automatically retried.
- **Rate limits** — Dataverse service protection limits (per-user burst/concurrent; see
  `docs/research/permissions-limits-blockers.md`). On `429`, `Retry-After` is honored.
- **Pagination** — list results return `nextLink` (`@odata.nextLink`); pass that link back
  to `dynamics.search_contact` to safely fetch the next page. Cross-origin/version links
  are rejected.
- **Security** — OAuth tokens never appear in logs or messages; `client_secret`,
  `access_token`, and `refresh_token` values are redacted from surfaced messages. Tokens
  are cached in memory only and refreshed before expiry.

---

## Limitations

1. **No committed credentials** — the connector reads config from the environment;
   real sandbox flows require your own `.env`.
2. **Live validation pending** — the final end-to-end run against a real Dynamics 365
   org was not performed because **no Microsoft 365 tenant and Azure AD environment is
   available**. The whole stack is proven offline: unit + integration tests (125) and
   `npm run demo` against the bundled mock sandbox. The submission note in
   `docs/SUBMISSION.md` states this explicitly with the steps to unblock.
3. **Write actions are not idempotent** — `create_*` actions create a new record on every
   call; dedupe via search (update_contact is PATCH-idempotent).
4. **Deep/batch inserts** are not exposed — each action maps to a single Web API request.
5. **`testConnection`** validates the credential shape and runs a real `WhoAmI()` probe
   only when a usable token source permits a real `WhoAmI()` probe; otherwise it fails.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` | Expired/invalid token | Refresh the token (`refresh_token` grant) or re-authenticate |
| `429 Too Many Requests` | Service protection limit | Safe reads/idempotent updates retry with backoff; creates return the error for reconciliation |
| `401 Unauthorized` from HTTP MCP | Missing/invalid MCP bearer key | Set `MCP_API_KEY` and send it as a Bearer token |
| `APPROVAL_REQUIRED` | Missing/invalid write approval | Obtain approval and provide the matching approval token |
| `404 Not Found` | Wrong entity set or record id | Verify entity name and GUID |
| `400 Invalid request` | Schema violation | Check the action input against its JSON Schema |
| Secrets in error text | Unsanitized provider message | Use `normalizeDynamicsError` (already wired in the client) |
| MCP server won't start | Missing `.env` / bad org URL | Confirm `D365_ORG_URL` and a valid token provider |
| MCP tools fail with `MISSING_CREDENTIALS` | No token source configured | Set `D365_ACCESS_TOKEN` (or `D365_REFRESH_TOKEN`/`D365_AUTH_CODE` + client fields) |

---

## Resources

- [Dataverse Web API overview](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview)
- [OAuth 2.0 with Dataverse](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth)
- [Service protection API limits](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/api-limits)
- [DOO Builders League](https://built2.doo.ooo/)
- `docs/research/api-endpoints-auth.md` · `docs/research/permissions-limits-blockers.md`
- Submission note (live-validation blocker): `docs/SUBMISSION.md`

## License

MIT. See `LICENSE` and `docs/THIRD_PARTY_NOTICES.md`.
