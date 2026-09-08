# Changelog

## Unreleased — security review remediation

- Enforce server-validated approval tokens before every write action.
- Disable automatic retry and retryable guidance for POST creates and DELETE requests.
- Require HTTP MCP bearer authentication, restrict CORS, and rate-limit callers.
- Use request-scoped provider clients and credential-identity-keyed OAuth token caching.
- Reject untrusted provider/token destinations and cross-origin pagination links.
- Preserve JSON Schema constraints in MCP and core runtime validation; expose output schemas.
- Require a usable token source for `testConnection` and always run `WhoAmI()` on success.
- Preserve observed provider rate-limit headers and support safe next-page consumption.
- Synchronize OpenAPI version 1.1.0, add an MIT license, notices, and clean dependency overrides.

All notable changes to the **dynamics365-connector** project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-08-10

### Added
- **OAuth wired into the connector core** (`src/connector.ts` + `src/auth`):
  the connector now acquires and refreshes tokens itself from
  `tenantId`/`clientId`/`clientSecret` (+ `code` or `refreshToken`) using the
  `authorization_code` and `refresh_token` grants, caches them in memory with
  skew-safe expiry, and falls back to a caller-supplied `accessToken`. New
  `acquireTokenResponse()` export returns the full token response for caching.
- **Real `testConnection` WhoAmI probe**: credentials are verified against the
  live Web API via `WhoAmI()` whenever a token source exists (result reported
  in `details.probe`; `skipped` otherwise). Never throws — probe failures are
  diagnostics with the normalized error code + request id.
- **Retry with exponential backoff** (`src/client.ts`): retryable failures
  (429 / 5xx / network) are retried automatically (default 2 attempts,
  configurable `maxRetries`), honoring the `Retry-After` header when present
  and capping the backoff. `ConnectorError` now carries `retryAfterMs`.
- **Mock Dynamics 365 sandbox** (`tests/sandbox/dynamics-sandbox.ts`): an
  in-process HTTP server simulating the Dataverse Web API v9.2 + Microsoft
  identity v2.0 token endpoint (OAuth grants, WhoAmI, OData list/create/update,
  `contains` filters, pagination with `@odata.nextLink`, `x-ms-request-id` +
  rate-limit headers, failure injection for retry tests).
- **Integration test suite** (`tests/integration.test.ts`): the real connector
  + MCP stack runs end-to-end against the sandbox over real HTTP (9 tests).
- **Offline demo** (`scripts/demo.ts`, `npm run demo`): boots the sandbox and
  drives all five actions through the real MCP protocol with a pass/fail report
  — proves the whole stack without a Microsoft 365 tenant or Azure AD.
- **`tests/auth.test.ts`**: 12 tests for OAuth grants, token mapping, the
  `tokenUrl` override, status-only error security, and scope/URL helpers.
- **CI workflow** (`.github/workflows/ci.yml`): Node 18/20/22 matrix running
  typecheck, lint, Prettier check, build, tests with the coverage gate,
  `npm audit`, and a secret scan.
- **Coverage gate** (`jest.config.js`): ≥80% statements/lines/functions and
  ≥70% branches (currently 92% statements / 82% branches).
- **MCP adapter reads credentials from the environment**
  (`mcp/server.ts`): `credentialsFromEnv()` maps `D365_ORG_URL`,
  `D365_ACCESS_TOKEN`, `D365_TENANT_ID`, `D365_CLIENT_ID`,
  `D365_CLIENT_SECRET`, `D365_REDIRECT_URI`, `D365_REFRESH_TOKEN`,
  `D365_AUTH_CODE`, `D365_TOKEN_URL`, `D365_SCOPE` onto connector
  credentials; `tokenUrl` support for tests/offline OAuth.
- `docs/SUBMISSION.md`: paste-ready submission note with the tenant-blocker
  statement for the DOO validation console.

### Changed
- Version `1.0.0` → `1.1.0` in `package.json`, `connector.yaml`, and the
  connector manifest.
- `examples/` + `scripts/` are now compiled by `tsc` — the documented
  `node dist/examples/*.js` commands work.
- `lint`/`format` scripts cover `examples/` and `scripts/` too.

### Fixed
- `dist/examples/` did not exist because `examples/` was excluded from the
  build (`tsconfig.json` include) — README commands now work.
- `testConnection` was shape-validation only; the documented WhoAmI probe is
  now implemented.

## [1.0.0] — 2026-08-04

### Added
- **M1 — Research & Planning**
  - `docs/research/api-endpoints-auth.md`: Dynamics 365 / Dataverse Web API endpoints
    (entity sets, CRUD mapping, query options, WhoAmI) and OAuth 2.0 flow
    (authorization_code + refresh_token, scopes, MSAL, S2S) — S1.1.1/S1.1.2.
  - `docs/research/permissions-limits-blockers.md`: Azure app registration permissions,
    service protection API limits, pagination, access blockers — S1.1.3–S1.1.5.
  - `src/schemas/index.ts`: JSON Schema (2020-12) input/output definitions for all five
    actions — S1.2.1–S1.2.5.
  - Project scaffolding: `package.json`, `tsconfig.json`, `.eslintrc.json`,
    `.prettierrc.json`, `jest.config.js`, `.env.example`, `.gitignore`,
    `connector.yaml` manifest — S1.3.1–S1.3.5.
- **M2 — Core Implementation**
  - `src/types.ts`: shared `DooConnector` contracts (manifest, testConnection,
    listActions, execute) — S2.2.1.
  - `src/client.ts`: Web API client (axios + OData headers, Bearer interceptor,
    normalized error interceptor, `get`/`post`/`patch`/`delete`/`whoAmI`) — S2.1.x.
  - `src/auth/index.ts`: OAuth 2.0 token acquisition and refresh — S2.1.2/S2.1.3.
  - `src/connector.ts`: connector core — lazy client from credentials, action
    registry with T1.2 schemas, `listActions`, `execute` routing, side-effect-free
    `testConnection` — S2.2.2–S2.2.4.
  - `src/errors/index.ts`: `ConnectorError` + `normalizeDynamicsError` (429/401/403/
    404/400/5xx/network/unknown) with `x-ms-request-id` extraction and secret
    redaction — S2.8.1–S2.8.3.
  - `src/actions/*.ts`: five action modules with typed handlers, input validation,
    approval documentation, and pagination/rate-limit metadata — S2.3.x–S2.7.x.
- **M3 — MCP Adapter & Testing**
  - `mcp/server.ts`: thin MCP adapter (tools → `connector.execute`) — S3.1.x.
  - `tests/fixtures/*.ts`: mock contacts, leads, tasks, and API responses — S3.3.x.
  - `examples/*.ts`: usage examples for each action — S3.4.x.
  - Permanent unit tests for client, connector, actions, and errors — S3.2.x.
- **M4 — Documentation & OpenAPI**
  - `openapi.yaml`: OpenAPI 3.1.0 specification — five action endpoints, input/output
    schemas, OAuth2 security scheme, examples — S4.1.x.
  - `README.md`: overview, installation, configuration, usage, limitations,
    troubleshooting — S4.2.x.
- **M5 — Security & Release**
  - Security review: no secrets in source, `.env` ignored, tokens never logged,
    `npm audit` clean — S5.2.x.

### Changed
- `connector.yaml` manifest version pinned to `1.0.0` (development package version
  `0.1.0`); all five action definitions carry `approval: required` on write actions.

### Fixed
- ESLint configuration: `.eslintrc.json` restored (flat `eslint.config.mjs` removed —
  incompatible with the installed eslint 8.x legacy config).
- Connector/client integration: client built lazily from request credentials
  (resolved the `Dynamics365Client(config)` constructor contract).

## [0.1.0] — 2026-08-04
### Added
- Project scaffolding (TypeScript, Jest + ts-jest, ESLint + Prettier).
- DOO `DooConnector` interface contracts.
- Dynamics 365 Web API research deliverables.
- Connector manifest (`connector.yaml`).

---

*Releases: `v1.0.0` (2026-08-04, initial full connector) and `v1.1.0`
(2026-08-10, OAuth wiring, WhoAmI probe, retry, CI, mock-sandbox integration
suite + offline demo). Tagged in Git; submission accompanies `v1.1.0`.*
