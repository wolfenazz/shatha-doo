# Handoff Notes — dynamics365-connector v1.1.0

**Builder:** Shatha Ebrahem · Cohort 01 (Aug–Sep 2026)
**Date:** 2026-08-10 · **Status:** Code complete — ready to submit (live validation blocked on tenant availability)

---

## 1. What was delivered

| Artifact | Path | Status |
|----------|------|--------|
| Connector manifest | `docs/connector.yaml` | ✅ v1.1.0, 5 actions, oauth2, capabilities + risks |
| Connector core (`DooConnector`) | `src/connector.ts` | ✅ manifest / listActions / execute / testConnection (WhoAmI probe) |
| OAuth 2.0 wired into the core | `src/connector.ts` + `src/auth/index.ts` | ✅ authorization_code + refresh_token, in-memory token cache, accessToken fast path |
| Web API client | `src/client.ts` | ✅ OData headers, Bearer interceptor, normalized errors, retry-with-backoff (honors `Retry-After`) |
| 5 action modules | `src/actions/*.ts` | ✅ search/create/update_contact, create_lead, create_task |
| JSON Schema 2020-12 (in/out + examples) | `src/schemas/index.ts` | ✅ all 5 exact ids |
| Normalized errors | `src/errors/index.ts` | ✅ ConnectorError + retry + requestId + redaction + retryAfterMs |
| Thin MCP stdio adapter | `mcp/server.ts` | ✅ tools/list + tools/call → connector.execute; env credentials via `credentialsFromEnv()` |
| HTTP MCP adapter (deployable) | `mcp/http-server.ts` | ✅ Streamable HTTP on `$PORT` |
| OpenAPI 3.1.x | `docs/openapi.yaml` | ✅ 5 action paths + schemas + auth |
| **Mock Dynamics 365 sandbox** | `tests/sandbox/dynamics-sandbox.ts` | ✅ OAuth token endpoint + Web API v9.2 simulation (new v1.1.0) |
| **Integration suite** | `tests/integration.test.ts` | ✅ 9 tests — real connector + MCP vs sandbox over real HTTP (new v1.1.0) |
| **Offline demo** | `scripts/demo.ts` (`npm run demo`) | ✅ 7/7 checks — full stack proof without a tenant (new v1.1.0) |
| Unit tests | `tests/*.test.ts` | ✅ 6 suites (client, connector, actions, errors, auth, mcp) |
| CI workflow | `.github/workflows/ci.yml` | ✅ Node 18/20/22: typecheck, lint, prettier, build, tests+coverage, audit, secret scan |
| README / HANDOFF / CHANGELOG / SUBMISSION | `README.md`, `docs/*.md` | ✅ v1.1.0 state + blocker statement |
| Fixtures + examples | `tests/fixtures/`, `examples/` | ✅ 5 entities + 5 examples (compiled to `dist/examples/`) |

## 2. Verification evidence (2026-08-10)

```
npx tsc --noEmit        → EXIT=0
npm run build           → EXIT=0
npm test                → 7 suites / 110 tests PASS (unit + integration)
npm run test:coverage   → 92.35% stmts / 82.22% branches (gate: 80/70)
npm run lint            → EXIT=0
npx prettier --check    → EXIT=0 (src, mcp, tests, examples, scripts)
npm audit               → 0 vulnerabilities
secret scan (CI)        → clean (no keys/tokens/private keys)
npm run demo            → 7/7 checks PASS (OAuth → connector core → MCP tools)
```

## 3. How to run

```bash
npm install
cp .env.example .env        # fill D365_ORG_URL + auth fields
npm run build
npm run demo                # offline end-to-end demo (mock sandbox, no tenant needed)
node dist/examples/search-contact.js   # per-action examples
node dist/mcp/server.js                 # MCP stdio server
node dist/mcp/http-server.js            # MCP Streamable HTTP server (deploy this)
```

The connector executes actions via `execute({ actionId, input, credentials })`; credentials need
`orgUrl` plus either `accessToken` or the OAuth client fields (`tenantId`/`clientId`/`clientSecret`
+ `code` or `refreshToken`). The MCP adapter reads `D365_*` variables from the environment.

## 4. Known limitations & blockers

1. **Real sandbox test (Definition of Done #9) — BLOCKED.** **No Microsoft 365 tenant or Azure AD
   environment is available**, which are required to register the Azure app and call the live
   Dataverse Web API. The full stack is instead proven offline: 110 tests + `npm run demo`
   (7/7) against the bundled mock sandbox. The submission note (`docs/SUBMISSION.md`) states this
   explicitly, as confirmed by the organizers. The moment a sandbox org + app registration are
   provisioned, run the `WhoAmI()` `testConnection` probe and one create flow to close this item.
2. **MCP auth is non-interactive** — the MCP adapter uses `D365_*` env credentials. Interactive
   OAuth (auth-code + PKCE/redirect) inside the MCP server is future work.
3. **Duplicate detection** on writes is suppressed by Dynamics by default; dedupe by searching
   before creating (documented in each write action's JSDoc).
4. **Rate limits** — ~60 req/min per user; the client retries retryable failures automatically
   with backoff (honoring `Retry-After`); tune `maxRetries` for your load.
5. `openapi.yaml` and `README.md` are authored to match the code; re-export after any schema change.

## 5. Recommended next steps

1. Submit to the DOO validation console (https://built2.doo.ooo/console) with the blocker note
   from `docs/SUBMISSION.md`; MCP URL = `https://shatha-doo-production.up.railway.app`.
2. When a Microsoft 365 tenant + Azure AD become available: provision the sandbox, register the
   Azure app, fill `.env`, run `testConnection` + one `dynamics.create_contact` flow
   (FINAL-STEPS.md Steps 1–4), then update the deployment's env vars and re-deploy (`railway up`).
3. Keep `CHANGELOG.md` updated; release tags `v1.0.0` + `v1.1.0` exist.
