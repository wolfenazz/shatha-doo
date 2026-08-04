# Changelog

All notable changes to the **dynamics365-connector** project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

*Repository commits: 4 baseline (initial commit, Builders League docs, skill guide,
TODO roadmap) + uncommitted feature work above. No tagged release yet — `v1.0.0`
tagging is part of the M5 release gate.*
