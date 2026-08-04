# Handoff Notes — dynamics365-connector v1.0.0

**Builder:** Shatha Ebrahem · Cohort 01 (Aug–Sep 2026)
**Date:** 2026-08-04 · **Status:** Ready for sandbox validation

---

## 1. What was delivered

| Artifact | Path | Status |
|----------|------|--------|
| Connector manifest | `connector.yaml` | ✅ v1.0.0, 5 actions, oauth2, capabilities + risks |
| Connector core (`DooConnector`) | `src/connector.ts` | ✅ manifest / listActions / execute / testConnection |
| Web API client | `src/client.ts` | ✅ OData headers, Bearer interceptor, normalized errors |
| OAuth 2.0 (code + refresh) | `src/auth/index.ts` | ✅ MSAL-shaped, secrets never logged |
| 5 action modules | `src/actions/*.ts` | ✅ search/create/update_contact, create_lead, create_task |
| JSON Schema 2020-12 (in/out + examples) | `src/schemas/index.ts` | ✅ all 5 exact ids |
| Normalized errors | `src/errors/index.ts` | ✅ ConnectorError + retry + requestId + redaction |
| Thin MCP stdio adapter | `mcp/server.ts` | ✅ tools/list + tools/call → connector.execute |
| OpenAPI 3.1.x | `openapi.yaml` | ✅ 5 action paths + schemas + auth |
| README | `README.md` | ✅ overview/install/config/usage/limitations |
| Tests | `tests/` | ✅ 73 unit tests, 5 suites, all green |
| Fixtures + examples | `tests/fixtures/`, `examples/` | ✅ 5 entities + 5 examples |
| Changelog | `CHANGELOG.md` | ✅ |

## 2. Verification evidence (2026-08-04)

```
npx tsc --noEmit        → EXIT=0
npm run build           → EXIT=0
npm test                → 5 suites / 73 tests PASS
npm run lint            → EXIT=0
npx prettier --check    → EXIT=0 (src, mcp, tests)
npm audit               → 0 vulnerabilities
secret scan             → clean (no keys/tokens/private keys)
```

## 3. How to run

```bash
npm install
cp .env.example .env        # fill D365_ORG_URL + auth fields
npm run build
node dist/examples/search-contact.js   # (after tsc build of examples)
node dist/mcp/server.js                 # MCP stdio server
```

The connector executes actions via `execute({ actionId, input, credentials })`; credentials need
`orgUrl` plus either `accessToken` or the OAuth client fields. The MCP adapter reads
`D365_ORG_URL` + `D365_ACCESS_TOKEN` from the environment.

## 4. Known limitations & blockers

1. **Real sandbox test (Definition of Done #9) — BLOCKED.** No Dynamics 365 test-tenant credentials
   were available during this build. All logic is verified offline via unit tests + fixtures
   (73/73 green). The moment a sandbox org + app registration are provisioned, run the
   `WhoAmI()` `testConnection` probe and one create flow to close this item.
2. **MCP auth is non-interactive** — the stdio adapter uses `D365_ACCESS_TOKEN` from the
   environment. Interactive OAuth (auth-code + PKCE/redirect) inside the MCP server is future work.
3. **Duplicate detection** on writes is suppressed by Dynamics by default; dedupe by searching
   before creating (documented in each write action's JSDoc).
4. **Rate limits** — ~60 req/min per user; the client normalizes 429s as retryable; callers should
   apply exponential backoff (no automatic retry loop is built in by design).
5. `openapi.yaml` and `README.md` are authored to match the code; re-export after any schema change.

## 5. Recommended next steps

1. Provision a Dynamics 365 sandbox + Azure app registration (scopes: `Dynamics CRM.*` as in
   `connector.yaml`), then run `testConnection` and one `dynamics.create_contact` flow.
2. Submit the MCP endpoint to the DOO validation console (https://built2.doo.ooo/console).
3. Tag `v1.0.0` (done in the release commit) and keep `CHANGELOG.md` updated.
