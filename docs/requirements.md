# Mission Requirements: Microsoft Dynamics 365 Connector

**Builder:** Shatha Ebrahem  
**Connector:** Microsoft Dynamics 365  
**Difficulty:** Advanced  
**Category:** Enterprise CRM  
**Cohort:** 01 · August–September 2026

---

## Overview

Your mission is to build a **production-oriented connector** for Microsoft Dynamics 365 that follows the DOO Builders League standard. The connector must be an independent, reusable package with five typed actions, safe authentication, tests, OpenAPI spec, and a thin MCP adapter.

---

## Your Five Required Actions

| # | Action ID | Description |
|---|-----------|-------------|
| 1 | `dynamics.search_contact` | Search for contacts in Dynamics 365 |
| 2 | `dynamics.create_contact` | Create a new contact record |
| 3 | `dynamics.update_contact` | Update an existing contact record |
| 4 | `dynamics.create_lead` | Create a new lead record |
| 5 | `dynamics.create_task` | Create a new task record |

> Extra actions are welcome after these five work.

---

## The Build Path (5 Steps)

### Step 1: Understand the Provider
- Confirm the current Microsoft Dynamics 365 API
- Set up a test account
- Understand the authentication flow (OAuth 2.0)
- Identify minimum scopes/permissions
- Document rate limits
- Identify any access blockers

### Step 2: Design the Five Actions
- Use the exact assigned action IDs above
- Define JSON Schema inputs for each action
- Define JSON Schema outputs for each action
- Create examples for each action
- Document approval requirements for write actions

### Step 3: Build One Reusable Core
- Implement `testConnection` function
- Implement `listActions` function
- Implement `execute` function
- Keep provider logic isolated
- Keep auth logic isolated
- Keep schemas isolated
- Implement normalized error handling

### Step 4: Expose a Thin MCP Adapter
- Map connector actions to MCP tools
- Do NOT duplicate provider calls in MCP server
- Do NOT duplicate business logic in MCP server
- MCP is only an adapter layer

### Step 5: Test, Deploy, and Validate
- Run unit tests
- Run fixture tests
- Prove one sandbox flow
- Deploy HTTPS MCP endpoint
- Submit to validation console

---

## Repository Structure

```
dynamics365-connector/
├── docs/
│   ├── connector.yaml              # Manifest file
│   ├── openapi.yaml                # OpenAPI 3.1.x specification
│   ├── SUBMISSION.md               # Submission note (live-validation blocker)
│   └── ...                         # Research, handoff, changelog, mission todo
├── src/
│   ├── connector.ts                # Main connector implementation (OAuth-wired core)
│   ├── client.ts                   # Dynamics 365 API client (+ retry with backoff)
│   ├── auth/
│   │   └── index.ts                # Authentication (OAuth 2.0, code + refresh)
│   ├── actions/
│   │   ├── search-contact.ts       # dynamics.search_contact
│   │   ├── create-contact.ts       # dynamics.create_contact
│   │   ├── update-contact.ts       # dynamics.update_contact
│   │   ├── create-lead.ts          # dynamics.create_lead
│   │   └── create-task.ts          # dynamics.create_task
│   ├── schemas/
│   │   └── index.ts                # JSON Schema definitions
│   └── errors/
│       └── index.ts                # Normalized error handling
├── mcp/
│   ├── server.ts                   # Thin MCP adapter (+ env credentials)
│   └── http-server.ts              # Streamable HTTP transport (deployment)
├── tests/
│   ├── sandbox/                    # Mock Dynamics 365 sandbox (offline proof)
│   ├── integration.test.ts         # Real connector vs sandbox over HTTP
│   ├── *.test.ts                   # Unit tests
│   └── fixtures/                   # Test fixtures
├── scripts/
│   └── demo.ts                     # Offline end-to-end demo (npm run demo)
├── examples/
│   └── ...                         # Usage examples
├── .github/workflows/ci.yml        # CI pipeline
├── .env.example                    # Environment variables template
└── README.md                       # Documentation
```

---

## The DooConnector Interface (Shared Standard)

Every connector MUST implement this interface:

```typescript
interface DooConnector {
  manifest: ConnectorManifest;
  testConnection(credentials): Promise<ConnectionTestResult>;
  listActions(): ConnectorAction[];
  execute(request): Promise<ConnectorExecutionResult>;
}
```

---

## Technical Standards

| Standard | Requirement |
|----------|-------------|
| Schema Format | JSON Schema 2020-12 |
| API Spec | OpenAPI 3.1.x |
| Errors | Normalized with request IDs + retry classification |
| Pagination | Return metadata where relevant |
| Rate Limits | Return metadata where relevant |
| Write Actions | Document approval, idempotency, duplicate, and retry behavior |
| Security | Least privilege, no committed secrets |

---

## Milestones

### Milestone 1: Kickoff (Mission Accepted)
- [ ] API/auth research complete
- [ ] Manifest (connector.yaml) created
- [ ] Five action schemas defined
- [ ] Repository plan documented
- [ ] Access risks identified

### Milestone 2: First Checkpoint (Build Continues)
- [ ] Repository structure created
- [ ] testConnection implemented
- [ ] Mocks set up
- [ ] One read action working
- [ ] Provider access confirmed or escalated

### Milestone 3: Week 1 Demo (Integration Candidate)
- [ ] Working authentication
- [ ] Two real actions working
- [ ] Normalized errors implemented
- [ ] Tests passing
- [ ] Initial MCP tools exposed

### Milestone 4: Final Handoff (v1.0.0 Ready)
- [ ] All five actions working
- [ ] Fixtures created
- [ ] OpenAPI spec complete
- [ ] Thin MCP server working
- [ ] Demo prepared
- [ ] Limitations documented
- [ ] Release tagged v1.0.0

---

## Definition of Done (12 Items)

Before handoff, verify ALL of these:

- [ ] Manifest identifies provider, version, auth type, scopes, actions, risks, and capabilities
- [ ] testConnection verifies credentials without creating side effects
- [ ] All five assigned actions work through the shared execute interface
- [ ] Every action has typed JSON Schema inputs, outputs, and examples
- [ ] Errors are normalized and include request IDs plus retry classification
- [ ] Pagination and rate-limit metadata are returned where relevant
- [ ] Write actions document approval, idempotency, duplicate, and retry behavior
- [ ] No secrets appear in code, Git history, logs, fixtures, screenshots, or recordings
- [ ] Unit and fixture tests pass, with one real sandbox test where access permits
- [ ] OpenAPI and the thin MCP adapter reuse the same connector core
- [ ] Known limitations and access blockers are clearly listed
- [ ] The release is tagged v1.0.0 with concise handoff notes

---

## Evaluation Criteria

| Criteria | Weight |
|----------|--------|
| Working actions and acceptance scenario | 25% |
| Authentication and security | 20% |
| Connector structure and reusability | 15% |
| Schemas and developer experience | 10% |
| Reliability, errors, pagination, rate limits | 10% |
| Testing and fixtures | 10% |
| Documentation and OpenAPI | 5% |
| Demonstration and technical explanation | 5% |

---

## Final Validation Process

1. **Deploy** — Expose a stable HTTPS MCP URL
2. **Authenticate** — Use a temporary bearer token if needed
3. **Validate** — Run contract, schema, and safety checks via validation console
4. **Review** — Share the result slug for review

> Validation console: https://built2.doo.ooo/console (requires @doo.ooo email)

---

## Key Rules

1. **Independent Package** — Build once; connect it to WZRD, CNCT, REST, SDKs, or MCP later
2. **Safe by Default** — Least privilege, no committed secrets, explicit approval for consequential writes
3. **Proven in Sandbox** — Tests, fixtures, and a real test-account flow without production customer data
4. **No Duplicated Logic** — MCP adapter must NOT contain provider calls or business logic
5. **Use .env** — Commit only `.env.example`, never live credentials

---

## Summary for Shatha

You need to build a **Microsoft Dynamics 365 connector** with these 5 actions:
1. Search contacts
2. Create contacts
3. Update contacts
4. Create leads
5. Create tasks

The connector must follow the DOO standard (DooConnector interface), include proper authentication (OAuth 2.0), have tests, OpenAPI spec, and be deployable as an MCP endpoint. Follow the 4 milestones and ensure all 12 "Definition of Done" items are checked before handoff.

**Good luck, Shatha! 🚀**
