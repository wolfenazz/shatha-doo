# Mission: Microsoft Dynamics 365 Connector

**Builder:** Shatha Ebrahem  
**Status:** IN_PROGRESS  
**Start Date:** 2026-08-04  
**Target:** v1.0.0

---

## M1: Research & Planning | status: in_progress

### T1.1: API Research | agent:Worker
- [ ] S1.1.1: Research Dynamics 365 Web API endpoints | size:S
- [ ] S1.1.2: Document OAuth 2.0 authentication flow | size:S
- [ ] S1.1.3: Identify Azure app registration permissions | size:S
- [ ] S1.1.4: Document rate limits and pagination | size:S
- [ ] S1.1.5: Identify access blockers and workarounds | size:S

### T1.2: Action Schema Design | agent:Worker | depends:T1.1
- [ ] S1.2.1: Design schema for dynamics.search_contact | size:M
- [ ] S1.2.2: Design schema for dynamics.create_contact | size:M
- [ ] S1.2.3: Design schema for dynamics.update_contact | size:M
- [ ] S1.2.4: Design schema for dynamics.create_lead | size:M
- [ ] S1.2.5: Design schema for dynamics.create_task | size:M

### T1.3: Project Setup | agent:Worker
- [ ] S1.3.1: Initialize Node.js project with TypeScript | size:S
- [ ] S1.3.2: Configure ESLint and Prettier | size:S
- [ ] S1.3.3: Set up Jest testing framework | size:S
- [ ] S1.3.4: Create .env.example | size:S
- [ ] S1.3.5: Create connector.yaml manifest | size:S

### T1.4: Milestone 1 Review | agent:Reviewer | depends:T1.1,T1.2,T1.3
- [ ] S1.4.1: Verify research documentation complete | size:S
- [ ] S1.4.2: Verify all 5 action schemas defined | size:S
- [ ] S1.4.3: Verify project structure ready | size:S

---

## M2: Core Implementation | status:pending | depends:M1

### T2.1: Client Implementation | agent:Worker
- [ ] S2.1.1: Implement Dynamics365Client class | size:L
- [ ] S2.1.2: Implement OAuth 2.0 token acquisition | size:M
- [ ] S2.1.3: Implement token refresh logic | size:M
- [ ] S2.1.4: Add request/response interceptors | size:M
- [ ] S2.1.5: Implement error normalization | size:M

### T2.2: Connector Core | agent:Worker | depends:T2.1
- [ ] S2.2.1: Implement DooConnector interface | size:M
- [ ] S2.2.2: Implement testConnection method | size:M
- [ ] S2.2.3: Implement listActions method | size:S
- [ ] S2.2.4: Implement execute method with routing | size:M

### T2.3: Action search_contact | agent:Worker | depends:T2.1
- [ ] S2.3.1: Implement search logic with OData | size:M
- [ ] S2.3.2: Add input validation | size:S
- [ ] S2.3.3: Add example responses | size:S

### T2.4: Action create_contact | agent:Worker | depends:T2.1
- [ ] S2.4.1: Implement create contact API call | size:M
- [ ] S2.4.2: Add input validation | size:S
- [ ] S2.4.3: Document approval requirement | size:S

### T2.5: Action update_contact | agent:Worker | depends:T2.1
- [ ] S2.5.1: Implement update contact API call | size:M
- [ ] S2.5.2: Add input validation | size:S
- [ ] S2.5.3: Document approval and idempotency | size:S

### T2.6: Action create_lead | agent:Worker | depends:T2.1
- [ ] S2.6.1: Implement create lead API call | size:M
- [ ] S2.6.2: Add input validation | size:S
- [ ] S2.6.3: Document approval requirement | size:S

### T2.7: Action create_task | agent:Worker | depends:T2.1
- [ ] S2.7.1: Implement create task API call | size:M
- [ ] S2.7.2: Add input validation | size:S
- [ ] S2.7.3: Document approval requirement | size:S

### T2.8: Error Handling | agent:Worker | depends:T2.1
- [ ] S2.8.1: Create ConnectorError class | size:S
- [ ] S2.8.2: Implement error normalization | size:M
- [ ] S2.8.3: Add retry classification | size:S

### T2.9: Milestone 2 Review | agent:Reviewer | depends:T2.1-T2.8
- [ ] S2.9.1: Verify testConnection works | size:S
- [ ] S2.9.2: Verify all 5 actions implemented | size:S
- [ ] S2.9.3: Verify error handling normalized | size:S

---

## M3: MCP Adapter & Testing | status:pending | depends:M2

### T3.1: MCP Server | agent:Worker
- [ ] S3.1.1: Set up MCP server | size:M
- [ ] S3.1.2: Register all 5 actions as tools | size:M
- [ ] S3.1.3: Implement tool execution routing | size:M
- [ ] S3.1.4: Add MCP error handling | size:S

### T3.2: Unit Tests | agent:Worker
- [ ] S3.2.1: Write tests for Dynamics365Client | size:M
- [ ] S3.2.2: Write tests for testConnection | size:M
- [ ] S3.2.3: Write tests for all 5 actions | size:L
- [ ] S3.2.4: Write tests for error handling | size:M

### T3.3: Fixtures | agent:Worker
- [ ] S3.3.1: Create mock contact data | size:S
- [ ] S3.3.2: Create mock lead data | size:S
- [ ] S3.3.3: Create mock task data | size:S
- [ ] S3.3.4: Create mock API responses | size:M

### T3.4: Examples | agent:Worker
- [ ] S3.4.1: Create example for search_contact | size:S
- [ ] S3.4.2: Create example for create_contact | size:S
- [ ] S3.4.3: Create example for update_contact | size:S
- [ ] S3.4.4: Create example for create_lead | size:S
- [ ] S3.4.5: Create example for create_task | size:S

### T3.5: Milestone 3 Review | agent:Reviewer | depends:T3.1-T3.4
- [ ] S3.5.1: Run all unit tests | size:S
- [ ] S3.5.2: Verify MCP tools discoverable | size:S
- [ ] S3.5.3: Verify fixtures work | size:S

---

## M4: Documentation & OpenAPI | status:pending | depends:M3

### T4.1: OpenAPI Specification | agent:Worker
- [ ] S4.1.1: Define OpenAPI 3.1.x structure | size:M
- [ ] S4.1.2: Add all 5 action endpoints | size:M
- [ ] S4.1.3: Add input/output schemas | size:M
- [ ] S4.1.4: Add authentication section | size:S
- [ ] S4.1.5: Add examples for each endpoint | size:M

### T4.2: README Documentation | agent:Worker
- [ ] S4.2.1: Write project overview | size:S
- [ ] S4.2.2: Document installation steps | size:S
- [ ] S4.2.3: Document configuration | size:S
- [ ] S4.2.4: Document usage for each action | size:M
- [ ] S4.2.5: Document limitations | size:S
- [ ] S4.2.6: Add troubleshooting section | size:S

### T4.3: Code Documentation | agent:Worker
- [ ] S4.3.1: Add JSDoc comments | size:M
- [ ] S4.3.2: Add inline comments | size:S
- [ ] S4.3.3: Update .env.example with comments | size:S

### T4.4: Milestone 4 Review | agent:Reviewer | depends:T4.1-T4.3
- [ ] S4.4.1: Verify OpenAPI spec valid | size:S
- [ ] S4.4.2: Verify README complete | size:S
- [ ] S4.4.3: Verify code documented | size:S

---

## M5: Final Validation & Release | status:pending | depends:M4

### T5.1: Final Testing | agent:Worker
- [ ] S5.1.1: Run full test suite | size:S
- [ ] S5.1.2: Test with real Dynamics 365 sandbox | size:L
- [ ] S5.1.3: Verify all 5 actions end-to-end | size:M
- [ ] S5.1.4: Test error scenarios | size:M

### T5.2: Security Review | agent:Worker
- [ ] S5.2.1: Verify no secrets in code | size:S
- [ ] S5.2.2: Verify .env in .gitignore | size:S
- [ ] S5.2.3: Verify OAuth tokens handled safely | size:S
- [ ] S5.2.4: Run security scan | size:S

### T5.3: Release Preparation | agent:Worker
- [ ] S5.3.1: Update version to 1.0.0 | size:S
- [ ] S5.3.2: Create CHANGELOG.md | size:S
- [ ] S5.3.3: Create git tag v1.0.0 | size:S
- [ ] S5.3.4: Prepare handoff notes | size:S

### T5.4: Definition of Done Check | agent:Reviewer | depends:T5.1-T5.3
- [ ] S5.4.1: Manifest complete | size:S
- [ ] S5.4.2: testConnection verified | size:S
- [ ] S5.4.3: All 5 actions working | size:S
- [ ] S5.4.4: JSON Schema inputs/outputs/examples | size:S
- [ ] S5.4.5: Errors normalized with request IDs | size:S
- [ ] S5.4.6: Pagination and rate-limit metadata | size:S
- [ ] S5.4.7: Write actions documented | size:S
- [ ] S5.4.8: No secrets exposed | size:S
- [ ] S5.4.9: Tests passing | size:S
- [ ] S5.4.10: OpenAPI and MCP reuse core | size:S
- [ ] S5.4.11: Limitations listed | size:S
- [ ] S5.4.12: Release tagged v1.0.0 | size:S

### T5.5: Final Mission Review | agent:Reviewer | depends:T5.4
- [ ] S5.5.1: Full system verification | size:S
- [ ] S5.5.2: Confirm all milestones complete | size:S
- [ ] S5.5.3: Confirm mission ready for handoff | size:S

---

## Progress Summary

| Milestone | Status | Tasks |
|-----------|--------|-------|
| M1: Research & Planning | IN_PROGRESS | 18 |
| M2: Core Implementation | PENDING | 26 |
| M3: MCP Adapter & Testing | PENDING | 17 |
| M4: Documentation & OpenAPI | PENDING | 14 |
| M5: Final Validation & Release | PENDING | 19 |
| **TOTAL** | - | **94** |
