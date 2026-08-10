# Submission Note — dynamics365-connector v1.1.0

**Builder:** Shatha Ebrahem · Cohort 01 · Aug–Sep 2026
**Status:** Ready to submit — code 100% complete, verified offline

---

## For the DOO validation console (paste-ready)

> **Microsoft Dynamics 365 Connector — submission note**
>
> The code is 100% complete and all offline checks pass (unit + integration +
> MCP-level tests, type checking, linting, dependency audit, secret scan).
> The connector is deployed as an HTTPS MCP endpoint at
> `https://shatha-doo-production.up.railway.app`.
>
> I was **not able to run the final live validation** (real sandbox flow)
> because **no Microsoft 365 tenant or Azure AD environment is available at
> this time** — those are required to register the Azure app, obtain OAuth
> credentials, and call the real Dataverse Web API.
>
> To close the loop once the environment is provisioned, the steps are
> documented in `FINAL-STEPS.md` (Steps 1–4): provision a Dynamics 365
> trial/developer environment, register the Azure app, set `.env`, then run
> `testConnection` (WhoAmI probe) and one `dynamics.create_contact` flow.
> In the meantime the connector is proven end-to-end against a bundled
> offline mock sandbox that simulates the Dataverse Web API v9.2 and the
> Microsoft identity v2.0 token endpoint (`npm run demo`).

---

## What is being submitted

| Item | Where |
|------|-------|
| Codebase ZIP (with `dist/` + tests) | repository root |
| Live MCP endpoint (HTTPS) | `https://shatha-doo-production.up.railway.app` |
| Offline demo (no tenant needed) | `npm run demo` |

## Verification evidence (offline)

```
npm run typecheck         → EXIT=0
npm run lint              → EXIT=0
npm run build             → EXIT=0
npm test                  → 7 suites / 110 tests PASS (unit + integration + MCP)
npm test -- --coverage    → ≥80% lines/statements/functions, ≥70% branches
npm run demo              → 7/7 checks PASS (OAuth → connector core → MCP tools)
npm audit                 → 0 vulnerabilities
secret scan (CI)          → clean
```

## When a Microsoft 365 tenant + Azure AD become available

1. Provision a Dynamics 365 trial (or Power Apps developer plan) → environment URL.
2. Register an Azure app with the `Dynamics CRM.*` delegated permissions
   (`docs/research/permissions-limits-blockers.md` §1) and grant admin consent.
3. Fill `.env` from `.env.example` (`D365_ORG_URL`, `D365_TENANT_ID`,
   `D365_CLIENT_ID`, `D365_CLIENT_SECRET`, `D365_REDIRECT_URI`).
4. Verify: `npm run build`, then run the `testConnection` WhoAmI probe and one
   `dynamics.create_contact` flow (commands in `FINAL-STEPS.md` Step 4).
5. Update the live deployment's environment variables and re-deploy
   (`railway up`).

---

*Last updated: 2026-08-10 · accompanies release tag `v1.1.0`*
