# Dynamics 365 / Dataverse Web API — Endpoints & Authentication

> Research deliverable for S1.1.1 (endpoints) and S1.1.2 (OAuth 2.0 flow).
> Builder: Shatha Ebrahem · Mission: Microsoft Dynamics 365 Connector (v1.0.0)

---

## Important Equivalence Note

The Microsoft Learn pages cached under `.opencode/docs/` document the **Microsoft Dataverse Web API**.
This is the **same Web API** used by **Dynamics 365 Customer Engagement** (Sales, Customer Service, etc.) at
API version **v9.2**. Throughout this document "Dataverse Web API" and "Dynamics 365 Web API" are interchangeable.

- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview

---

## 1. Base URL and Headers

### 1.1 Base URL

```
https://<org>.api.crm.dynamics.com/api/data/v9.2/
```

- `<org>` = the organization (environment) name, e.g. `contoso`.
- `v9.2` = current Web API version.
- Every request targets this root plus an entity set name (see section 2).

### 1.2 Required HTTP headers

| Header | Value | Purpose |
|--------|-------|---------|
| `Authorization` | `Bearer <access_token>` | OAuth 2.0 access token |
| `Content-Type` | `application/json` | Request body type (write ops) |
| `Accept` | `application/json` | Response body type |
| `OData-MaxVersion` | `4.0` | Tells the server the max OData version you can handle |
| `OData-Version` | `4.0` | Declares the OData version of the request |

- Confirmed in the cached docs: create requests send `OData-MaxVersion: 4.0`
  (see `.opencode/docs/learn_microsoft_com_en-us_power-apps_developer_data-platform_webapi_cr.md`).
- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/compose-http-requests-handle-errors

---

## 2. Entity Set Names and CRUD Operations (S1.1.1)

### 2.1 Entity sets used by this connector

| Entity | Entity set (collection) | Primary key | Name column |
|--------|-------------------------|-------------|-------------|
| Contact | `contacts` | `contactid` (Edm.Guid) | `fullname` |
| Lead | `leads` | `leadid` (Edm.Guid) | `fullname` |
| Task | `tasks` | `activityid` (Edm.Guid) | `subject` |

- The Task primary key `activityid` and name column `subject` are confirmed in the cached
  entity reference (`.opencode/docs/learn_microsoft_com_en-us_power-apps_developer_data-platform_webapi_re.md`).
- Task entity supports operations: `POST GET PATCH DELETE`.

### 2.2 Operation → HTTP method mapping

The Web API exposes CRUD as RESTful operations (`GET`, `POST`, `PATCH`, `DELETE`) — the same
create/retrieve/update/delete messages as the SDK for .NET.

| Operation | HTTP method | Example URL |
|-----------|-------------|-------------|
| Query / retrieve list | `GET` | `/api/data/v9.2/contacts?$select=firstname,lastname&$filter=...` |
| Create | `POST` | `/api/data/v9.2/contacts` |
| Update | `PATCH` | `/api/data/v9.2/contacts(<contactid>)` |
| Delete | `DELETE` | `/api/data/v9.2/contacts(<contactid>)` |
| Retrieve single | `GET` | `/api/data/v9.2/contacts(<contactid>)` |

- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview
- Note: For `PATCH`, include the header `Content-Type: application/json` and send only the
  fields being updated. The `If-Match` header (with `*` or an ETag) can be used for optimistic concurrency.

### 2.3 Key fields per entity

**Contact** (`contacts`)

| Field | Type | Notes |
|-------|------|-------|
| `contactid` | Edm.Guid | Primary key |
| `firstname` | Edm.String | First name |
| `lastname` | Edm.String | Last name |
| `fullname` | Edm.String | Read-only computed full name |
| `emailaddress1` | Edm.String | Primary email |
| `telephone1` | Edm.String | Primary phone |
| `companyname` | Edm.String | Company / account name |

**Lead** (`leads`)

| Field | Type | Notes |
|-------|------|-------|
| `leadid` | Edm.Guid | Primary key |
| `firstname` | Edm.String | First name |
| `lastname` | Edm.String | Last name |
| `fullname` | Edm.String | Read-only computed full name |
| `emailaddress1` | Edm.String | Primary email |
| `companyname` | Edm.String | Company |
| `subject` | Edm.String | Lead subject |

**Task** (`tasks`)

| Field | Type | Notes |
|-------|------|-------|
| `activityid` | Edm.Guid | Primary key (confirmed in cached entity reference) |
| `subject` | Edm.String | Primary name column (confirmed) |
| `description` | Edm.String | Task details (confirmed in cached entity reference) |
| `scheduledstart` | Edm.DateTimeOffset | Planned start (confirmed) |
| `scheduledend` | Edm.DateTimeOffset | Planned end (confirmed) |
| `regardingobjectid` | Edm.Guid (lookup) | Related record (account/contact/lead/opportunity) |

### 2.4 Querying (search_contact)

Query options supported by the Web API:

| Option | Example | Purpose |
|--------|---------|---------|
| `$filter` | `$filter=contains(fullname,'john')` | Filter rows (OData functions like `contains`, `startswith`, `eq`, `and`, `or`) |
| `$select` | `$select=contactid,firstname,lastname,emailaddress1` | Project only needed columns (perf) |
| `$top` | `$top=10` | Limit page size (max 5000) |
| `$orderby` | `$orderby=fullname asc` | Sort results |
| `$count` | `$count=true` | Return `@odata.count` of total rows |

- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-data-web-api

**Response envelope** for a query:

```json
{
  "@odata.context": "https://<org>.api.crm.dynamics.com/api/data/v9.2/$metadata#contacts(firstname,lastname)",
  "value": [
    { "contactid": "11111111-1111-1111-1111-111111111111", "firstname": "John", "lastname": "Doe" }
  ],
  "@odata.nextLink": "https://<org>.api.crm.dynamics.com/api/data/v9.2/contacts?$skiptoken=X%27...%27"
}
```

- `value` = array of rows.
- `@odata.nextLink` = URL for the next page (see rate-limits doc for pagination details).

### 2.5 Create / update behaviors (write actions)

- **Create**: `POST /contacts` with JSON body of fields. Response `201 Created` with the
  header `OData-EntityId` containing the URI of the new record (e.g. `.../contacts(<guid>)`).

- **Return created data**: add the header `Prefer: return=representation` to get the full
  created record in the response body (confirmed in cached create-entity doc).


- **Update**: `PATCH /contacts(<contactid>)` with the fields to change; returns `204 No Content`
  by default.


- **Duplicate detection**: by default the system suppresses duplicate detection on create;
  send `MSCRM.SuppressDuplicateDetection: false` to enable it.


- Sources:
  - https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-entity-web-api
  - https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/update-delete-entities-using-web-api

### 2.6 Connection test (testConnection)

Use the `WhoAmI()` function — a lightweight, side-effect-free endpoint:

```
GET https://<org>.api.crm.dynamics.com/api/data/v9.2/WhoAmI()
```

Response:

```json
{
  "@odata.context": ".../$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse",
  "BusinessUnitId": "guid",
  "UserId": "guid",
  "OrganizationId": "guid"
}
```

- A `200` response with a `UserId` proves the OAuth token is valid and scoped.
- Confirmed in cached auth doc: `client.GetAsync("WhoAmI").Result`
  (`.opencode/docs/learn_microsoft_com_en-us_power-apps_developer_data-platform_authentic.md`).
- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/whoami

---

## 3. OAuth 2.0 Authentication (S1.1.2)

### 3.1 Flow: Authorization Code + refresh_token

Recommended for interactive/native clients (a human user granting access):

```
OAuth 2.0 Authorization Code Flow
├── Authorize URL: https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize
├── Token URL:     https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
├── Scope:         https://<org>.api.crm.dynamics.com/.default
└── Grant types:   authorization_code  →  refresh_token
```

**Step 1 — Authorize** (browser redirect):
`GET {authorize}?client_id=...&response_type=code&redirect_uri=...&scope=https://<org>.api.crm.dynamics.com/.default&response_mode=query`

**Step 2 — Exchange code for tokens**:
`POST {token}` with `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri`.

**Step 3 — Refresh** (before expiry / after 401):
`POST {token}` with `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`.

### 3.2 Token response fields

| Field | Description |
|-------|-------------|
| `access_token` | Bearer token for `Authorization: Bearer <access_token>` |
| `refresh_token` | Long-lived token used to obtain new access tokens |
| `expires_in` | Lifetime of access token in seconds (typically 3600) |
| `token_type` | Usually `Bearer` |
| `scope` | Scopes granted |

### 3.3 Scope selection

| Client type | Scope |
|-------------|-------|
| Public client (interactive, ROPC, device code) | `https://<org>.api.crm.dynamics.com/user_impersonation` |
| Confidential client (S2S, client credentials) | `https://<org>.api.crm.dynamics.com/.default` |

- Confirmed in cached auth doc: "use a `<environment-url>/user_impersonation` scope for a public
  client. For a confidential client, use a scope of `<environment-url>/.default`."
- Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth

### 3.4 MSAL recommendation

Use **Microsoft Authentication Library (MSAL)** — `@azure/msal-node` for Node.js — instead of
hand-rolling token exchange. MSAL handles:

- Token caching and silent refresh.
- Redirect / auth-code parsing.
- Error classification (e.g. `InteractionRequiredAuthError`).
- Client credentials and authorization-code flows under one API.

- Source: https://learn.microsoft.com/en-us/entra/identity-platform/msal-overview

### 3.5 Secure token handling (security rules)

- **Never log tokens** — not `access_token`, `refresh_token`, or client secrets.
- Store tokens in memory / secure secret store only; persist `refresh_token` encrypted if needed.
- Use `client_secret` from environment variables (`.env`), never committed to Git
  (`.env.example` only).
- Treat `refresh_token` like a password: it grants ongoing access until revoked.
- Scopes should be least-privilege: request only the resource needed
  (`https://<org>.api.crm.dynamics.com/.default`), not broad Microsoft Graph scopes.

### 3.6 Alternative: Client Credentials (server-to-server, S2S)

For unattended integrations (no interactive user), use the **client credentials** grant with an
app registration that has a security role assigned in the Power Platform admin center:

- `grant_type=client_credentials` at the token endpoint.
- No refresh token needed; access tokens are minted per request.
- The app is represented by an "application user" in Dataverse with a security role (e.g.
  "Dynamics 365 Sales" role) — see permissions-limits-blockers.md.
- Sources:
  - https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-single-tenant-server-server-authentication
  - https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-multi-tenant-server-server-authentication

---

## Sources

- Use the Microsoft Dataverse Web API — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview
- Use OData to query data — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-data-web-api
- Create a table row using the Web API — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-entity-web-api
- Update and delete table rows using the Web API — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/update-delete-entities-using-web-api
- Compose HTTP requests and handle errors — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/compose-http-requests-handle-errors
- Use OAuth authentication with Microsoft Dataverse — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth
- Tutorial: Register an app with Microsoft Entra ID — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/walkthrough-register-app-azure-active-directory
- Task entity reference — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/task
- WhoAmI function reference — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/whoami
- Service protection API limits — https://learn.microsoft.com/en-us/power-apps/developer/data-platform/api-limits

> Cached raw scrapes used as source material: `.opencode/docs/learn_microsoft_com_en-us_power-apps_developer_data-platform_{webapi_ov,webapi_qu,webapi_cr,webapi_re,authentic}.md`
