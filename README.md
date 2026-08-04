# Dynamics 365 Connector

A production-oriented **Microsoft Dynamics 365 connector** for the DOO Builders League,
built to the shared `DooConnector` standard. It wraps the Dynamics 365 (Dataverse) Web API
v9.2 as an independent, reusable TypeScript package with **five typed actions**, safe
OAuth 2.0 authentication, normalized errors, unit tests, an OpenAPI 3.1 spec, and a thin
MCP adapter.

> **Builder:** Shatha Ebrahem · Cohort 01 · Aug–Sep 2026
> **Provider:** Microsoft Dynamics 365 (Web API v9.2) · **Category:** Enterprise CRM

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
├── connector.yaml            # Manifest: provider, auth, actions, capabilities, risks
├── openapi.yaml              # OpenAPI 3.1.x specification (one path per action)
├── src/
│   ├── connector.ts          # Dynamics365Connector core (DooConnector contract)
│   ├── client.ts             # Web API client: axios + OData headers + interceptors
│   ├── auth/index.ts         # OAuth 2.0 authorization_code + refresh_token
│   ├── actions/              # 5 action modules (definition + handler + validation)
│   ├── schemas/index.ts      # JSON Schema 2020-12 input/output definitions (T1.2)
│   ├── errors/index.ts       # ConnectorError + normalizeDynamicsError + retry flags
│   └── types.ts              # Shared DooConnector contracts
├── mcp/server.ts             # Thin MCP adapter (tools -> connector.execute)
├── tests/                    # Unit tests + fixtures
├── examples/                 # Usage examples for each action
├── docs/research/            # API/endpoints/auth/limits research (S1.1.x)
├── .env.example              # Environment template (no secrets committed)
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

# Run tests (Jest + ts-jest)
npm test

# Lint & format
npm run lint
npm run format
```

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

if (result.success) {
  console.log(result.data); // { contacts, count, nextLink? }
} else {
  console.error(result.error); // ConnectorError { code, message, requestId, retryable }
}

// Verify credentials without side effects (shape validation; WhoAmI probe planned)
const check = await connector.testConnection({ orgUrl: '...', clientId: '...', /* ... */ });
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

### MCP adapter (stdio)

```bash
node dist/mcp/server.js
```

The server exposes all five actions as MCP tools (`dynamics.search_contact`, ...). It is a
**thin adapter only** — every tool call forwards to the shared `connector.execute()` core
(no duplicated provider or business logic).

---

## Reliability & Error Handling

- **Normalized errors** — every failure is a `ConnectorError` with a machine-readable
  `code`, secret-safe `message`, the provider `requestId` (from `x-ms-request-id`), and a
  `retryable` classification (see `src/errors/index.ts`).
- **Rate limits** — Dataverse service protection limits (per-user burst/concurrent; see
  `docs/research/permissions-limits-blockers.md`). On `429`, retry with exponential
  backoff; `Retry-After` is honored when present.
- **Pagination** — list results return `nextLink` (`@odata.nextLink`) and pagination
  metadata.
- **Security** — OAuth tokens never appear in logs or messages; `client_secret`,
  `access_token`, and `refresh_token` values are redacted from surfaced messages.

---

## Limitations

1. **No committed credentials** — the connector reads config from the environment;
   real sandbox flows require your own `.env`.
2. **Sandbox access** — end-to-end verification against a real Dynamics 365 test org
   requires an authorized tenant/account (see `docs/research/permissions-limits-blockers.md` §3).
3. **Write actions are not idempotent** — `create_*` actions create a new record on every
   call; dedupe via search (update_contact is PATCH-idempotent).
4. **Deep/batch inserts** are not exposed — each action maps to a single Web API request.
5. **`testConnection`** currently validates the credential shape without a network call;
   a `WhoAmI()` probe is planned once token acquisition is wired into the core.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` | Expired/invalid token | Refresh the token (`refresh_token` grant) or re-authenticate |
| `429 Too Many Requests` | Service protection limit | Retry with exponential backoff; honor `Retry-After` |
| `404 Not Found` | Wrong entity set or record id | Verify entity name and GUID |
| `400 Invalid request` | Schema violation | Check the action input against its JSON Schema |
| Secrets in error text | Unsanitized provider message | Use `normalizeDynamicsError` (already wired in the client) |
| MCP server won't start | Missing `.env` / bad org URL | Confirm `D365_ORG_URL` and a valid token provider |

---

## Resources

- [Dataverse Web API overview](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview)
- [OAuth 2.0 with Dataverse](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth)
- [Service protection API limits](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/api-limits)
- [DOO Builders League](https://built2.doo.ooo/)
- `docs/research/api-endpoints-auth.md` · `docs/research/permissions-limits-blockers.md`

## License

Private — DOO Builders League cohort project (no license, all rights reserved).
