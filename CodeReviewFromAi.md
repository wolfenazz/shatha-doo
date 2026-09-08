# DOO BUILDERS LEAGUE / CONNECTOR REVIEW

## Connector Assessment — Microsoft Dynamics 365

| Field | Details |
|-------|---------|
| **Builder** | shatha (shathakhlifat@gmail.com) |
| **Score** | **66 / 100 — FAIL** |
| **Assessed** | 8 Sept 2026, 13:26 |
| **Model** | gpt-5.6 |
| **Source** | partial |
| **MCP** | not verified |
| **Sandbox** | not verified |

> Source: partial | MCP: not verified | Sandbox: not verified

---

## Executive Summary

**Static-source verdict: needs_review, 66/100.**

The repository contains all five required action implementations, a reusable connector core, typed schemas, OAuth support, tests, fixtures, OpenAPI, documentation, and thin MCP adapters.

Runtime behavior, tests, sandbox acceptance, and MCP deployment were **not verified**.

Two source-confirmed hard gates are present:

1. Write approval is declared but not enforced.
2. The generic HTTP client automatically retries non-idempotent create requests.

No supplied evidence confirms production credentials or customer data; scanner findings were redacted and largely occur in test/config assignments.

---

## Hard-Gate Results

### 1. Consequential writes lack an enforced approval safeguard

The four write actions declare `approval: required`, but `Dynamics365Connector.execute` and the MCP tool handler do not validate an approval decision before invoking the provider action.

### 2. Dangerous retry behavior applies to side effects

`Dynamics365Client.post` uses the same `withRetry` wrapper as reads, automatically retrying 429, 5xx, and network failures even though `create_contact`, `create_lead`, and `create_task` are documented as non-idempotent and not retry-safe.

---

## Rubric

### 1. Working Actions and Acceptance Scenario — `partial` — 18/25

**Evidence:**

- Source modules exist for all five exact actions under `src/actions`, with corresponding compiled artifacts.
- `Dynamics365Connector` registers handlers for:
  - `dynamics.search_contact`
  - `dynamics.create_contact`
  - `dynamics.update_contact`
  - `dynamics.create_lead`
  - `dynamics.create_task`
- Action source maps search to `GET /contacts`, creates to `POST /contacts`, `/leads`, and `/tasks`, and update to `PATCH /contacts(<contactid>)`.
- `tests/integration.test.ts` and `scripts/demo.ts` contain mock-sandbox acceptance scenarios covering `testConnection`, MCP discovery, and all five actions.

**Gaps:**

- No participant code was executed, so no action passed runtime acceptance.
- The bundled sandbox is a mock rather than a real Dynamics 365 test account.
- README and HANDOFF explicitly state that live validation against a Dynamics tenant was not performed.
- No deployed URL was submitted, and no MCP endpoint was called.

---

### 2. Authentication and Security — `failed` — 10/20

**Evidence:**

- `src/auth` implements `authorization_code` and `refresh_token` grants with form-encoded token requests.
- The connector supports environment-provided access tokens and in-memory OAuth token caching.
- Normalized error messages include credential-pattern redaction, and OAuth HTTP errors surface status-only messages.
- `docs/connector.yaml` marks all four write actions as `approval: required`.
- `mcp/http-server.ts` sets wildcard CORS and exposes the MCP transport without an application-level authentication or authorization check.

**Gaps:**

- Approval metadata is declarative only; `execute` and MCP tools do not require or verify approval before writes.
- The HTTP MCP adapter has no demonstrated access control while using server-side D365 credentials, allowing an exposed deployment to make provider calls for unauthenticated callers.
- `orgUrl` and `tokenUrl` are caller-configurable without supplied evidence of HTTPS enforcement or Dynamics/Microsoft host allowlisting.
- `testConnection` can report success after skipping WhoAmI when OAuth client fields exist but no code, refresh token, or access token exists.
- The connector caches one client and token cache per connector instance without keying them by organization or credential identity, creating cross-request credential/org reuse risk in shared-library use.

---

### 3. Connector Structure and Reusability — `partial` — 12/15

**Evidence:**

- Provider client, OAuth, actions, schemas, errors, shared types, and connector core are separated under `src`.
- `mcp/server.ts` iterates `connector.listActions` and forwards calls to `connector.execute` rather than duplicating provider requests.
- Both stdio and Streamable HTTP MCP adapters reuse `createMcpServer`.
- The connector exposes `manifest`, `testConnection`, `listActions`, and `execute`.

**Gaps:**

- The core retains the first `Dynamics365Client` in `this.client` and returns it for later executions regardless of new credentials or `orgUrl`.
- Token cache state is not associated with a particular tenant or credential set.
- The supplied source excerpts do not cover every original source file in full.

---

### 4. Schemas and Developer Experience — `partial` — 8/10

**Evidence:**

- `src/schemas` defines input and output schemas for all five exact action IDs.
- The supplied schema artifacts identify the Draft 2020-12 dialect and include descriptions, examples, required fields, GUID patterns, and `additionalProperties` controls.
- Each action attaches `inputSchema`, `outputSchema`, descriptions, and examples.
- TypeScript interfaces are supplied for action inputs and outputs.

**Gaps:**

- The MCP JSON-Schema-to-Zod translation preserves only basic property types and required/optional status; it drops constraints such as `minLength`, `maximum`, `format`, `pattern`, `anyOf`, item schemas, and `additionalProperties`.
- The MCP adapter does not expose the action output schema in the shown `registerTool` configuration.
- Runtime action validation does not fully enforce the published schemas; for example, task date-time strings are not format-validated and unknown properties are generally ignored rather than rejected.
- Schema validity was not independently parsed or tested during this assessment.

---

### 5. Reliability, Errors, Pagination, Rate Limits — `failed` — 3/10

**Evidence:**

- `ConnectorError` includes `code`, `requestId`, `retryable`, `providerError`, and `retryAfterMs`.
- `normalizeDynamicsError` classifies 429, authentication, authorization, not-found, invalid request, 5xx, network, and unknown failures.
- Retry-After parsing and bounded exponential backoff are implemented.
- `search_contact` returns `@odata.nextLink` and basic pagination metadata.

**Gaps:**

- `withRetry` is applied indiscriminately to POST, PATCH, DELETE, and GET; non-idempotent creates may be duplicated after ambiguous failures.
- No idempotency key or effective duplicate-prevention mechanism is implemented for create actions; searching first is only documented guidance.
- Pagination returns `nextLink` but provides no source-verified continuation action or safe next-page consumption mechanism.
- Successful provider rate-limit headers are discarded because client helpers return only `response.data`; search returns a hard-coded policy string rather than observed limit metadata.
- Retry behavior is not selected by HTTP method or action safety metadata.

---

### 6. Testing and Fixtures — `partial` — 8/10

**Evidence:**

- Unit-test source is present for actions, auth, client, connector, errors, and MCP.
- Fixtures are present for contacts, leads, tasks, and provider responses.
- `tests/integration.test.ts` defines an HTTP mock-sandbox scenario for OAuth, WhoAmI, all five actions, pagination, retries, errors, and MCP.
- CI source defines typecheck, lint, formatting, build, Jest coverage, dependency audit, and secret-scan steps.

**Gaps:**

- No tests were executed during this assessment; repository claims of passing tests and coverage are unverified.
- Integration tests use a bundled mock provider rather than a real Dynamics sandbox.
- The supplied tests appear to expect automatic retry generally and do not demonstrate suppression of retries for non-idempotent creates.
- No source evidence demonstrates enforced approval-denial tests for write actions.

---

### 7. Documentation and OpenAPI — `partial` — 4/5

**Evidence:**

- `README.md` documents installation, configuration, usage, reliability, deployment, troubleshooting, and known limitations.
- `docs/openapi.yaml` declares OpenAPI 3.1.0 and includes paths for the five exact action operationIds, OAuth, schemas, examples, and approval extensions.
- `docs/connector.yaml`, `.env.example`, CHANGELOG, HANDOFF, and provider research documents are present.
- README explicitly discloses that live validation is pending.

**Gaps:**

- OpenAPI `info.version` is `1.0.0` while the package, connector manifest, README, and changelog identify version `1.1.0`.
- No dedicated dependency-license inventory or license artifact was identified; `package.json` is private and README states no project license.
- The OpenAPI document was truncated in supplied excerpts and was not independently parsed.
- Documentation says creates are not retry-safe, but implementation automatically retries POST requests.

---

### 8. Demonstration and Technical Explanation — `partial` — 3/5

**Evidence:**

- `scripts/demo.ts` contains a step-by-step offline demonstration covering WhoAmI, MCP discovery, and all five actions.
- README and HANDOFF explain architecture, OAuth, retries, errors, MCP adaptation, setup, and the live-tenant blocker.
- Examples exist for every required action.

**Gaps:**

- The demo was not executed and its reported 7/7 output is a repository claim.
- The demo uses the bundled mock sandbox, not Microsoft Dynamics 365.
- No deployed endpoint or external validation result was supplied.
- No independent demonstration artifact or recorded technical walkthrough was supplied in the evidence.

---

## Required Action Coverage

| Action ID | Status | Details |
|-----------|--------|---------|
| `dynamics.search_contact` | FOUND | `src/actions/search-contact.ts` is present. Compiled source shows the exact action ID, OData `GET /contacts` handler, input/output schemas, examples, and `nextLink` metadata. `tests/actions.test.ts` and `tests/integration.test.ts` contain source scenarios for the action. |
| `dynamics.create_contact` | FOUND | `src/actions/create-contact.ts` is present. Compiled source shows the exact action ID and `POST /contacts` handler with approval metadata. Tests and the offline demo contain source scenarios for the action. |
| `dynamics.update_contact` | FOUND | `src/actions/update-contact.ts` is present. Compiled source shows the exact action ID and `PATCH /contacts(<contactid>)` handler with approval and idempotency metadata. Tests and the offline demo contain source scenarios for the action. |
| `dynamics.create_lead` | FOUND | `src/actions/create-lead.ts` is present. Compiled source shows the exact action ID and `POST /leads` handler with approval metadata. Tests and the offline demo contain source scenarios for the action. |
| `dynamics.create_task` | FOUND | `src/actions/create-task.ts` is present. Compiled source shows the exact action ID and `POST /tasks` handler with approval metadata. Tests and the offline demo contain source scenarios for the action. |

---

## Findings

### [CRITICAL] Write approval is declared but not enforced

**Evidence:**

The action definitions and `docs/connector.yaml` set `approval: required`, but `Dynamics365Connector.execute` routes directly to handlers without checking `request.metadata`. `mcp/server.ts` also calls `connector.execute` without an approval value, so MCP write calls can reach POST/PATCH handlers directly.

**Remediation:**

Introduce a trusted approval context and reject every write before provider access unless approval has been explicitly granted and validated. Add denial and bypass-resistance tests.

### [CRITICAL] Non-idempotent creates are automatically retried

**Evidence:**

`Dynamics365Client.post` calls `withRetry`, which retries retryable 429, 5xx, and network failures. `create_contact`, `create_lead`, and `create_task` all call `client.post` while documenting that they are non-idempotent and not retry-safe.

**Remediation:**

Do not automatically retry these create operations. Only permit retries when protected by provider-supported idempotency or effective duplicate detection and reconciliation.

### [HIGH] HTTP MCP deployment lacks demonstrated access control

**Evidence:**

`mcp/http-server.ts` accepts MCP requests, creates a server using environment credentials, and sets `Access-Control-Allow-Origin: *`. No authentication or authorization check is shown.

**Remediation:**

Require authenticated and authorized callers, restrict CORS to trusted origins where applicable, and prevent anonymous use of server-held Dynamics credentials.

### [HIGH] Connector can reuse the first caller's client and credentials

**Evidence:**

`Dynamics365Connector.getClient` returns `this.client` once initialized. Later `execute` calls with a different `orgUrl` or credentials therefore continue using the first client and token provider; `tokenCache` is also a single unkeyed field.

**Remediation:**

Use request-scoped clients and token state, or cache them using a strong key that includes organization, tenant, and principal identity.

### [MEDIUM] testConnection may succeed without testing credentials

**Evidence:**

When `orgUrl` and OAuth client fields are present but no `accessToken`, `code`, or `refreshToken` is supplied, `probeConnection` returns success with `probe.status` set to `skipped`.

**Remediation:**

Return an indeterminate or failed result until a usable token source allows the side-effect-free WhoAmI probe.

### [MEDIUM] MCP schema translation drops safety and validation constraints

**Evidence:**

`jsonSchemaToZodShape` maps only primitive type and required status. It does not preserve `anyOf`, patterns, formats, min/max constraints, array item schemas, or `additionalProperties`.

**Remediation:**

Use the canonical JSON Schemas directly or implement complete constraint-preserving conversion and shared-core schema validation.

### [MEDIUM] Provider and token URLs are insufficiently constrained

**Evidence:**

The connector accepts `orgUrl` and `tokenUrl` from credentials and uses them for HTTP requests. Supplied source does not show HTTPS enforcement, Microsoft/Dynamics host validation, or private-network rejection.

**Remediation:**

Validate schemes and expected hosts and block loopback, private, link-local, and metadata-service destinations in production.

### [LOW] Release documentation and license evidence are incomplete

**Evidence:**

`docs/openapi.yaml` reports `info.version 1.0.0` while the package and connector are `1.1.0`. No dependency-license inventory was identified, and README states the project has no license.

**Remediation:**

Synchronize versions and include an explicit project license decision plus generated third-party notices or dependency-license inventory.

---

## Manual Follow-Ups

- [ ] Do not run the submission outside a sandbox until approval enforcement and POST retry behavior are fixed.
- [ ] Independently run `npm ci`, typecheck, lint, build, tests, coverage, audit, and the offline demo; all current pass claims remain unverified.
- [ ] Inspect and adjudicate the redacted credential-assignment findings. The supplied evidence does not establish that any are real production secrets.
- [ ] Run a real Dynamics 365 sandbox acceptance flow using non-production data and temporary least-privilege credentials.
- [ ] Deploy and validate an authenticated HTTPS MCP endpoint; no deployed URL was included in the submission metadata.
- [ ] Verify the complete, untruncated OpenAPI document with an OpenAPI 3.1 validator.
- [ ] Review dependency licenses from `package-lock.json` and generate a third-party notices report.
- [ ] Security-test `orgUrl` and `tokenUrl` handling for SSRF and private-network access, and test sequential multi-tenant executions for credential leakage.

---

## Report Record

| Field | Value |
|-------|-------|
| **Assessment ID** | `574a55ca-9805-4c3e-8cd3-dc52aa137878` |
| **Submission ID** | `ba20d330-432d-44a4-a978-4ae1ec46d28e` |
| **Submission SHA-256** | `0cf8f2a845f6b217c6c51fa310e888a46696ce78005ef4bc58bec61d9b3217d1` |
| **Original ZIP** | `dynamics365-connector-v1.1.0.zip` |
| **Submitted** | 8 Sept 2026, 13:25 |

> DOO Builders League | Source-only assessment
