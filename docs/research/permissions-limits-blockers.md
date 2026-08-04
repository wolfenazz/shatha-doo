# Dynamics 365 / Dataverse — Permissions, Rate Limits & Access Blockers

> Research deliverable for S1.1.3 (app registration permissions), S1.1.4 (rate limits & pagination),
> and S1.1.5 (access blockers & workarounds).
> Builder: Shatha Ebrahem · Mission: Microsoft Dynamics 365 Connector (v1.0.0)

---

## 1. Azure App Registration & Permissions (S1.1.3)

### 1.1 Registration steps

Per the Microsoft walkthrough (cached: `.opencode/docs/learn_microsoft_com_en-us_power-apps_developer_data-platform_walkthrou.md`):

1. Sign in to the **Azure portal** (https://portal.azure.com) with an account that has
   **administrator permission**, in the same Microsoft 365 subscription (tenant) as the
   Dynamics 365 environment.
2. **Microsoft Entra ID** → **App registrations** → **New registration**.
3. Provide a name; choose supported account types (single tenant is simplest for S2S;
   multi-tenant if you must serve many customers).
4. **Redirect URI** — select a platform and enter the URI:
   - Native/desktop/mobile: `app://<guid>` (confirmed in cached auth doc).
   - Web/MCP callback: `https://<your-mcp-endpoint>/callback` (or `http://localhost:3000/callback` for local dev).
5. **API permissions** → **Add a permission** → **Dynamics CRM** → **Delegated permissions** →
   select **`user_impersonation`** ("Access Dynamics 365 as organization users").
6. **Grant admin consent** for the tenant (see section 1.3). If the button is ghosted you lack
   permission — ask a tenant admin.
7. **Certificates & secrets** → **New client secret** → copy the **value immediately** (it is
   shown only once).

- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/walkthrough-register-app-azure-active-directory

### 1.2 Required API permissions

| Permission | Type | Purpose |
|------------|------|---------|
| `Dynamics CRM.user_impersonation` | Delegated | Access Dataverse as the signed-in organization user (interactive flows) |
| `user_impersonation` via `.default` scope | Delegated (confidential) | Used when requesting the resource's `.default` scope |
| (none extra) | — | Server-to-server apps get data access via an **application user + security role**, not delegated permissions |

- Confirmed in cached docs: the walkthrough selects the **`user_impersonation`** delegated
  permission; the auth doc says "Access Dynamics 365 as organization users".
- For **client credentials / S2S**: no delegated permission is required; instead the app
  registration is added to Power Platform admin center as an **application user** and granted a
  **security role** (e.g. Dynamics 365 Sales, or a custom least-privilege role).
- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth

### 1.3 Admin consent

- For delegated permissions, a tenant administrator must grant consent before tokens are issued
  at runtime; otherwise you get a consent error (e.g. `AADSTS65001`).
- In the Azure portal: **API permissions** → **Grant admin consent for <tenant>** → **Yes**.
- For single-tenant S2S apps, consent is granted once per tenant — "no need for a tenant
  administrator to grant consent for each organization" (confirmed in cached single-tenant doc).
- Sources:
  - https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-single-tenant-server-server-authentication
  - https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview

### 1.4 Client secret handling

- Store the secret in environment variables (`.env`), never in code or Git.
- Commit only `.env.example` with placeholder values.
- **Never log the secret or the token.**
- Rotate secrets periodically; revoke immediately if compromised.
- Prefer **certificates** over secrets for production S2S when possible (stronger, no shared secret).

### 1.5 Least privilege

- Request only the `Dynamics CRM` resource — not Microsoft Graph — for this connector.
- Use `https://<org>.api.crm.dynamics.com/.default` as the scope for confidential clients so
  only the CRM resource is covered.
- In Power Platform admin center, grant the application user the **minimum security role**
  that allows contacts/leads/tasks CRUD (e.g. "Dynamics 365 Sales" for full CRM; a custom role
  with only Contact/Lead/Task read+create+update for tighter control).
- Writes (`create_*`, `update_*`) should remain behind explicit approval in the connector UI/MCP layer.

---

## 2. Rate Limits & Pagination (S1.1.4)

### 2.1 Service protection API limits

Microsoft enforces **service protection API limits** (not simple per-minute quotas). From the
cached official doc (`.opencode/docs/learn_microsoft_com_en-us_power-apps_developer_data-platform_api-limit.md`):

| Measure | Limit (per web server, per user) |
|---------|----------------------------------|
| Number of requests | **6,000 within a five-minute (300 s) sliding window** |
| Combined execution time | An aggregate time budget for processing the user's requests in the 5-minute window |
| Concurrent requests | A cap on simultaneous in-flight requests (exceeding it fails immediately) |

Key facts from the doc:

- Limits are evaluated **per user account** and **per web server**; environments usually have
  multiple web servers, but **trial environments allocate only a single web server** — so limits
  bind much sooner in trials.
- The three facets (request count, execution time, concurrency) prevent bypass via batching or
  parallel bursts.
- When exceeded, the Web API returns **`429 Too Many Requests`** with a **`Retry-After`** header
  (seconds).
- The Retry-After duration grows if the client keeps hammering; honor it exactly.

### 2.2 Handling 429 responses (required behavior)

1. **Honor `Retry-After`**: parse the header and wait that many seconds before retrying
   (confirmed: "the response includes a Retry-After header with number of seconds").
2. **Fallback: exponential backoff** with jitter (e.g. 1 s, 2 s, 4 s, 8 s … capped) when
   `Retry-After` is absent.
3. Limit retries per request (e.g. 3–5 attempts) to avoid compounding load.
4. Surface rate-limit metadata to callers so MCP consumers can pace themselves.

### 2.3 Debug headers

| Header | Meaning |
|--------|---------|
| `x-ms-ratelimit-burst-remaining-xrm-requests` | Remaining requests for this connection |
| `x-ms-ratelimit-time-remaining-xrm-requests` | Remaining combined duration for all connections under the same user |

- **Do not depend on these to throttle** — Microsoft states they are "intended for debugging
  purposes" and reset when the affinity cookie changes server.
- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/api-limits

### 2.4 Pagination

- Default page size is **5,000 rows**; `$top` values above 5,000 are not permitted.
- Responses include **`@odata.nextLink`** — a server-generated URL (often with a `$skiptoken`
  paging cookie) to fetch the next page. Follow it verbatim; do not re-derive offsets.
- Do not use deep **`$skip`** values to page through large sets — they are inefficient and the
  paging cookie approach is the supported mechanism.
- If you need aggregated totals, request `$count=true` (returns `@odata.count`).
- Use `$select` to limit columns and `$filter` to narrow results; combine with `$top` for
  "search-style" reads.
- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/page-results

---

## 3. Access Blockers & Workarounds (S1.1.5)

| # | Blocker | Description | Workaround |
|---|---------|-------------|------------|
| 1 | **Trial tenant signup** | Dynamics 365 requires a licensed environment; trials expire (e.g. 30-day Dynamics 365 trial, or Power Apps developer plan) | Use a **Microsoft 365 developer / Power Apps Developer Plan** environment for sandbox testing; plan for trial expiry; keep tests + fixtures independent of live data |
| 2 | **Admin consent missing** | Delegated permissions fail at runtime with a consent error until a tenant admin approves | Grant admin consent in Azure portal (section 1.3); document consent as a prerequisite in README |
| 3 | **MFA / Conditional Access** | Tenant policies force MFA or block non-interactive logins, breaking client-credentials/ROPC flows | Use **client credentials (S2S)** with an application user (MFA is not applied to service principals in most configs); or device-code flow for interactive MFA-capable login |
| 4 | **CORS for MCP endpoint** | Browser-based MCP clients cannot call the API without CORS headers | Web API supports CORS; configure allowed origins; for server-side MCP servers CORS is not an issue — prefer server-to-server calls |
| 5 | **License / security-role requirements** | A user without a Dynamics 365 license or with an insufficient security role gets `403/401` on contacts/leads/tasks | Assign a **Dynamics 365 Sales (or custom) security role** to the app user / test user in Power Platform admin center; verify with `WhoAmI()` then a minimal `GET /contacts` |
| 6 | **Token expiry** | Access tokens expire (~1 h); stale tokens cause 401s | Use **refresh_token** grant before expiry; implement silent refresh (MSAL); on 401 retry once after refresh |
| 7 | **Rate limits in trials** | Single web server in trial environments → 429s much earlier | Keep request volume low in tests; honor Retry-After; use `$select`/`$top` to minimize heavy queries |
| 8 | **No real customer data** | Sandbox must never touch production data | Use isolated dev/test environment + fixture data; no production org URL in committed config |

---

## Sources

- Service protection API limits (Microsoft Dataverse) — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/api-limits
- Tutorial: Register an app with Microsoft Entra ID — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/walkthrough-register-app-azure-active-directory
- Use OAuth authentication with Microsoft Dataverse — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth
- Use single-tenant server-to-server authentication — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-single-tenant-server-server-authentication
- Use multi-tenant server-to-server authentication — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-multi-tenant-server-server-authentication
- Overview of user and admin consent (Microsoft Entra ID) — https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview
- Page results using OData — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/page-results
- About trial environments — https://learn.microsoft.com/en-us/power-platform/admin/trial-environments
- Security roles and privileges for Dataverse — https://learn.microsoft.com/en-us/power-platform/admin/security-roles-privileges

> Cached raw scrapes used as source material: `.opencode/docs/learn_microsoft_com_en-us_power-apps_developer_data-platform_{api-limit,authentic,walkthrou,use-singl}.md`
