# Builders League Connector Test Suite

> Source: https://built2.doo.ooo/
> Cached: 2026-08-04T14:25:47.641Z

---

Cohort 01 · August–September 2026# Build one connector.
Ship it clean.

Your mission is to deliver one independent, production-oriented connector with five typed actions, safe authentication, tests, OpenAPI, and a thin MCP adapter.

[See the build path ](#build-path)[ Open presentation](/presentation)27

builder missions

135

required actions

5

actions each

1

shared standard

Independent package

Build once; connect it to WZRD, CNCT, REST, SDKs, or MCP later.

Safe by default

Least privilege, no committed secrets, explicit approval for consequential writes.

Proven in a sandbox

Tests, fixtures, and a real test-account flow without production customer data.

The build path

## From assigned mission to deployed MCP

Follow this sequence. Escalate provider-access blockers early instead of hiding them behind mocks.

01

### Understand the provider

Confirm the current API, test account, authentication flow, minimum scopes, rate limits, and access blockers before coding.

02

### Design the five actions

Use the exact assigned action IDs. Define JSON Schema inputs, outputs, examples, and approval requirements for writes.

03

### Build one reusable core

Implement testConnection, listActions, and execute once. Keep provider, auth, schemas, and normalized errors isolated.

04

### Expose a thin MCP adapter

Map the same connector actions to MCP tools. Do not duplicate provider calls or business logic inside the MCP server.

05

### Test, deploy, and validate

Run unit and fixture tests, prove one sandbox flow, deploy an HTTPS MCP endpoint, and submit it to the validation console.

Technical structure

## One core. Multiple surfaces.

The connector owns provider logic. MCP is only an adapter that exposes those same actions as tools.

Provider API

Connector core

Thin MCP server

interface DooConnector {
  manifest: ConnectorManifest;
  testConnection(credentials): Promise<ConnectionTestResult>;
  listActions(): ConnectorAction[];
  execute(request): Promise<ConnectorExecutionResult>;
}### Recommended repository

Portable packageCopyconnector-name/
├── connector.yaml
├── src/
│   ├── connector.ts
│   ├── client.ts
│   ├── auth/
│   ├── actions/
│   ├── schemas/
│   └── errors/
├── mcp/server.ts
├── tests/
├── fixtures/
├── examples/
├── openapi.yaml
├── .env.example
└── README.mdMission finder

## Find your exact five actions

Search your name, connector, or category. Extra actions are welcome, but these five must work first.

Ali IsaSalesforceRabab Mansoor HasanMicrosoft 365 / GraphShatha EbrahemMicrosoft Dynamics 365Haitham Al AmriShopifyAlia BurashedGoogle DriveYousif AlblooshiGoogle CalendarMuntadher AlmutawajOdooHawra Fadhel Abbas KhalifaStripeLamees DawoodMoyasarManar Majeed Ahmed Hasan MohamedGoogle SheetsSayed Haider AlHashemiSlackAhmed AlMerbatiNotionDuaa AhmedCanvaIdrees KhaledAsanaAli Mohamed AltalWebflowLaith AlhaddadGoogle DocsAbdulla AlHejairiGmailFatema AlQassabZoho CRMHussain AlbooriHubSpotBaraah Mohammed EliaseFreshsalesZahra AlmosawiZidHashem Saeed AlkhanaiziGeneric HTTP / WebhookMohammed Majeed AlasadSallaRehab KhalidWooCommerceMurtadha DakheelFoodicsAlia MahfoodhSquarespaceAbdalameer YusufWixYour assigned connector

### Google Sheets

IntermediateProductivityBuilder

Manar Majeed Ahmed Hasan Mohamed

Build these five actions1`sheets.read_range`2`sheets.find_rows`3`sheets.append_rows`4`sheets.update_row`5`sheets.create_spreadsheet`Milestones

## Build through visible gates

1Kickoff

Mission acceptedAPI/auth research, manifest, five action schemas, repository plan, access risks

2First checkpoint

Build continuesRepository, testConnection, mocks, one read action, provider access confirmed or escalated

3Week 1 demo

Integration candidateWorking auth, two real actions, normalized errors, tests, initial MCP tools

4Final handoff

v1.0.0 readyAll actions, fixtures, OpenAPI, thin MCP server, demo, limitations, versioned release

Evaluation

## What earns the score

Working actions and acceptance scenario25%Authentication and security20%Connector structure and reusability15%Schemas and developer experience10%Reliability, errors, pagination, rate limits10%Testing and fixtures10%Documentation and OpenAPI5%Demonstration and technical explanation5%Final validation

## Deploy it. Then prove it.

The validation console connects to your HTTPS MCP endpoint, discovers tools, matches required actions, checks schemas and safety metadata, and optionally runs sandbox examples.

[ Open validation console](/console)### Deploy

Expose a stable HTTPS MCP URL.

### Authenticate

Use a temporary bearer token if needed.

### Validate

Run contract, schema, and safety checks.

### Review

Share the result slug for review.

Definition of done

## Check your work before handoff

Use this as your final self-review. A feature is not complete if its failure, duplicate, retry, and approval behavior are unclear.

Your progress

0 of 12 complete

 ResetManifest identifies provider, version, auth type, scopes, actions, risks, and capabilities.testConnection verifies credentials without creating side effects.All five assigned actions work through the shared execute interface.Every action has typed JSON Schema inputs, outputs, and examples.Errors are normalized and include request IDs plus retry classification.Pagination and rate-limit metadata are returned where relevant.Write actions document approval, idempotency, duplicate, and retry behavior.No secrets appear in code, Git history, logs, fixtures, screenshots, or recordings.Unit and fixture tests pass, with one real sandbox test where access permits.OpenAPI and the thin MCP adapter reuse the same connector core.Known limitations and access blockers are clearly listed.The release is tagged v1.0.0 with concise handoff notes.Ready to start?

## Research first. Build once. Explain everything.

[Launch kickoff presentation ](/presentation)