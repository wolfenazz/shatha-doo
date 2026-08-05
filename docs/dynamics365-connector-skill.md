# Dynamics 365 Connector Development Skill

> A professional development guide for building production-oriented DOO connectors.

---

## Purpose

This skill provides a structured, efficient workflow for building the Microsoft Dynamics 365 connector following the DOO Builders League standard. Use this as your development reference throughout the project.

---

## Quick Reference

| Item | Value |
|------|-------|
| Connector | Microsoft Dynamics 365 |
| Difficulty | Advanced |
| Auth Type | OAuth 2.0 |
| API Version | v9.2 (latest) |
| Base URL | `https://<org>.api.crm.dynamics.com/api/data/v9.2/` |
| Schema Standard | JSON Schema 2020-12 |
| API Spec | OpenAPI 3.1.x |

---

## Phase 1: Research & Setup (Day 1)

### 1.1 Dynamics 365 API Research

**Authentication Flow:**
```
OAuth 2.0 Authorization Code Flow
├── Authorization URL: https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize
├── Token URL: https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
├── Scopes: https://<org>.api.crm.dynamics.com/.default
└── Grant Type: authorization_code + refresh_token
```

**Required Azure App Registration:**
- Register app in Azure Portal
- Set redirect URI
- Generate client secret
- Add Dynamics CRM permissions:
  - `Dynamics CRM.UserBasic`
  - `Dynamics CRM.UserBasic.All`
  - `Dynamics CRM.Organization.Read`
  - `Dynamics CRM.Organization.Write`

**Rate Limits:**
- Per-user: 60 requests per minute (varies by license)
- Concurrent: 10 requests per user
- Implement exponential backoff on 429 responses

### 1.2 Environment Setup

**.env.example:**
```env
# Dynamics 365 Configuration
D365_ORG_URL=https://<your-org>.api.crm.dynamics.com
D365_TENANT_ID=<azure-tenant-id>
D365_CLIENT_ID=<azure-app-client-id>
D365_CLIENT_SECRET=<azure-app-client-secret>
D365_REDIRECT_URI=http://localhost:3000/callback

# Optional
D365_API_VERSION=v9.2
D365_LOG_LEVEL=info
```

### 1.3 Project Initialization

```bash
# Create project structure
mkdir dynamics365-connector
cd dynamics365-connector
npm init -y

# Install dependencies
npm install typescript @types/node axios dotenv
npm install --save-dev jest @types/jest ts-jest

# Initialize TypeScript
npx tsc --init
```

---

## Phase 2: Core Implementation

### 2.1 Manifest (connector.yaml)

```yaml
name: dynamics365-connector
version: 1.0.0
description: Microsoft Dynamics 365 connector for DOO
provider:
  name: Microsoft Dynamics 365
  version: v9.2
  type: Enterprise CRM
auth:
  type: oauth2
  grantTypes:
    - authorization_code
    - refresh_token
  scopes:
    - Dynamics CRM.UserBasic
    - Dynamics CRM.Organization.Read
    - Dynamics CRM.Organization.Write
actions:
  - id: dynamics.search_contact
    type: read
    description: Search for contacts
  - id: dynamics.create_contact
    type: write
    description: Create a new contact
    approval: required
  - id: dynamics.update_contact
    type: write
    description: Update an existing contact
    approval: required
  - id: dynamics.create_lead
    type: write
    description: Create a new lead
    approval: required
  - id: dynamics.create_task
    type: write
    description: Create a new task
    approval: required
capabilities:
  pagination: true
  rateLimiting: true
  retry: true
risks:
  - Write actions modify production data
  - OAuth tokens expire and need refresh
  - Rate limits may affect batch operations
```

### 2.2 Connector Interface Pattern

```typescript
// src/connector.ts
import { DooConnector, ConnectorManifest, ConnectionTestResult, ConnectorAction, ConnectorExecutionResult } from './types';

export class Dynamics365Connector implements DooConnector {
  manifest: ConnectorManifest;
  private client: Dynamics365Client;

  constructor() {
    this.manifest = this.loadManifest();
    this.client = new Dynamics365Client();
  }

  async testConnection(credentials: any): Promise<ConnectionTestResult> {
    // Implementation
  }

  listActions(): ConnectorAction[] {
    // Return all 5 actions
  }

  async execute(request: any): Promise<ConnectorExecutionResult> {
    // Route to appropriate action
  }
}
```

### 2.3 Client Implementation Pattern

```typescript
// src/client.ts
import axios, { AxiosInstance } from 'axios';

export class Dynamics365Client {
  private instance: AxiosInstance;
  private accessToken: string | null = null;

  constructor() {
    this.instance = axios.create({
      baseURL: process.env.D365_ORG_URL,
      headers: {
        'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
      },
    });

    // Add request interceptor for auth
    this.instance.interceptors.request.use(async (config) => {
      if (!this.accessToken) {
        await this.authenticate();
      }
      config.headers.Authorization = `Bearer ${this.accessToken}`;
      return config;
    });

    // Add response interceptor for error handling
    this.instance.interceptors.response.use(
      (response) => response,
      (error) => this.handleError(error)
    );
  }

  private async authenticate(): Promise<void> {
    // OAuth 2.0 token acquisition
  }

  private handleError(error: any): never {
    // Normalize errors with request IDs
  }
}
```

### 2.4 Action Implementation Pattern

```typescript
// src/actions/search-contact.ts
import { ConnectorAction, ConnectorExecutionResult } from '../types';

export const searchContactAction: ConnectorAction = {
  id: 'dynamics.search_contact',
  name: 'Search Contact',
  description: 'Search for contacts in Dynamics 365',
  type: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term' },
      filter: { type: 'string', description: 'OData filter expression' },
      top: { type: 'number', description: 'Max results', default: 10 },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      contacts: { type: 'array', items: { $ref: '#/definitions/Contact' } },
      count: { type: 'number' },
    },
  },
  examples: [
    {
      input: { query: 'John', top: 5 },
      output: {
        contacts: [
          {
            id: '-guid',
            firstname: 'John',
            lastname: 'Doe',
            email: 'john@example.com',
          },
        ],
        count: 1,
      },
    },
  ],
};

export async function executeSearchContact(
  client: Dynamics365Client,
  input: any
): Promise<ConnectorExecutionResult> {
  const { query, filter, top } = input;

  let odataFilter = `contains(fullname,'${query}')`;
  if (filter) {
    odataFilter = `${odataFilter} and ${filter}`;
  }

  const response = await client.get('/contacts', {
    params: {
      $filter: odataFilter,
      $top: top || 10,
      $select: 'contactid,firstname,lastname,emailaddress1',
    },
  });

  return {
    success: true,
    data: {
      contacts: response.data.value,
      count: response.data.value.length,
    },
    metadata: {
      requestId: response.headers['x-ms-request-id'],
    },
  };
}
```

### 2.5 Error Handling Pattern

```typescript
// src/errors/index.ts
export class ConnectorError extends Error {
  code: string;
  requestId?: string;
  retryable: boolean;
  providerError?: any;

  constructor(
    message: string,
    code: string,
    requestId?: string,
    retryable = false,
    providerError?: any
  ) {
    super(message);
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
    this.providerError = providerError;
  }
}

export function normalizeDynamicsError(error: any): ConnectorError {
  const requestId = error.response?.headers?.['x-ms-request-id'];

  if (error.response?.status === 429) {
    return new ConnectorError(
      'Rate limit exceeded',
      'RATE_LIMIT_EXCEEDED',
      requestId,
      true,
      error.response.data
    );
  }

  if (error.response?.status === 401) {
    return new ConnectorError(
      'Authentication failed',
      'AUTH_FAILED',
      requestId,
      false,
      error.response.data
    );
  }

  if (error.response?.status === 404) {
    return new ConnectorError(
      'Resource not found',
      'NOT_FOUND',
      requestId,
      false,
      error.response.data
    );
  }

  return new ConnectorError(
    error.message || 'Unknown error',
    'UNKNOWN_ERROR',
    requestId,
    false,
    error.response?.data
  );
}
```

---

## Phase 3: MCP Adapter

### 3.1 MCP Server Pattern

```typescript
// mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server';
import { Dynamics365Connector } from '../src/connector';

const connector = new Dynamics365Connector();
const server = new McpServer({
  name: 'dynamics365-connector',
  version: '1.0.0',
});

// Register each action as an MCP tool
connector.listActions().forEach((action) => {
  server.tool(
    action.id,
    action.description,
    action.inputSchema,
    async (params) => {
      try {
        const result = await connector.execute({
          actionId: action.id,
          input: params,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result.data) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
});

export default server;
```

---

## Phase 4: Testing

### 4.1 Unit Test Pattern

```typescript
// tests/connector.test.ts
import { Dynamics365Connector } from '../src/connector';

describe('Dynamics365Connector', () => {
  let connector: Dynamics365Connector;

  beforeEach(() => {
    connector = new Dynamics365Connector();
  });

  describe('testConnection', () => {
    it('should return success with valid credentials', async () => {
      const result = await connector.testConnection({
        orgUrl: 'https://test.crm.dynamics.com',
        accessToken: 'valid-token',
      });
      expect(result.success).toBe(true);
    });

    it('should return failure with invalid credentials', async () => {
      const result = await connector.testConnection({
        orgUrl: 'https://test.crm.dynamics.com',
        accessToken: 'invalid-token',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('listActions', () => {
    it('should return 5 actions', () => {
      const actions = connector.listActions();
      expect(actions).toHaveLength(5);
    });

    it('should have required action IDs', () => {
      const actions = connector.listActions();
      const ids = actions.map((a) => a.id);
      expect(ids).toContain('dynamics.search_contact');
      expect(ids).toContain('dynamics.create_contact');
      expect(ids).toContain('dynamics.update_contact');
      expect(ids).toContain('dynamics.create_lead');
      expect(ids).toContain('dynamics.create_task');
    });
  });
});
```

### 4.2 Fixture Pattern

```typescript
// fixtures/contacts.ts
export const mockContacts = [
  {
    contactid: '11111111-1111-1111-1111-111111111111',
    firstname: 'John',
    lastname: 'Doe',
    emailaddress1: 'john.doe@example.com',
    telephone1: '+1-555-0101',
    companyname: 'Example Corp',
  },
  {
    contactid: '22222222-2222-2222-2222-222222222222',
    firstname: 'Jane',
    lastname: 'Smith',
    emailaddress1: 'jane.smith@example.com',
    telephone1: '+1-555-0102',
    companyname: 'Another Corp',
  },
];

export const mockLeads = [
  {
    leadid: '33333333-3333-3333-3333-333333333333',
    firstname: 'Bob',
    lastname: 'Wilson',
    emailaddress1: 'bob.wilson@potential.com',
    companyname: 'Potential Client Inc',
    subject: 'Interested in services',
  },
];
```

---

## Phase 5: OpenAPI Specification

### 5.1 OpenAPI Pattern

```yaml
# openapi.yaml
openapi: 3.1.0
info:
  title: Dynamics 365 Connector API
  version: 1.0.0
  description: Microsoft Dynamics 365 connector for DOO
servers:
  - url: https://your-mcp-endpoint.com
paths:
  /search-contact:
    post:
      operationId: dynamics.search_contact
      summary: Search for contacts
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SearchContactInput'
      responses:
        '200':
          description: Successful search
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SearchContactOutput'
components:
  schemas:
    SearchContactInput:
      type: object
      properties:
        query:
          type: string
          description: Search term
        filter:
          type: string
          description: OData filter
        top:
          type: number
          description: Max results
      required:
        - query
```

---

## Phase 6: Deployment

### 6.1 Deployment Checklist

- [ ] All 5 actions implemented and tested
- [ ] OAuth flow working with test account
- [ ] MCP server deployed to HTTPS endpoint
- [ ] Environment variables secured (not in code)
- [ ] OpenAPI spec complete
- [ ] README with usage instructions
- [ ] Examples directory populated
- [ ] v1.0.0 tag created

### 6.2 Deployment Commands

```bash
# Build
npm run build

# Test
npm test

# Tag release
git tag -a v1.0.0 -m "Initial release"
git push origin v1.0.0

# Deploy (varies by platform)
# For Vercel:
vercel --prod

# For Railway:
git push railway main

# For custom:
npm run deploy
```

---

## Development Commands Reference

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

---

## Common Patterns & Tips

### Retry Logic
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.retryable && attempt < maxRetries - 1) {
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Rate Limiting
```typescript
class RateLimiter {
  private requests: number[] = [];
  private maxRequests = 60;
  private windowMs = 60000;

  async acquire(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const waitTime = this.windowMs - (now - this.requests[0]);
      await sleep(waitTime);
    }

    this.requests.push(Date.now());
  }
}
```

### Pagination
```typescript
async function getAllPages<T>(
  client: Dynamics365Client,
  endpoint: string,
  pageSize = 100
): Promise<T[]> {
  const allResults: T[] = [];
  let nextLink: string | null = endpoint;

  while (nextLink) {
    const response = await client.get(nextLink);
    allResults.push(...response.data.value);
    nextLink = response.data['@odata.nextLink'] || null;

    if (nextLink) {
      await sleep(100); // Rate limit protection
    }
  }

  return allResults;
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Refresh token or re-authenticate |
| 429 Rate Limited | Implement exponential backoff |
| 404 Not Found | Verify entity name and ID |
| Token expired | Use refresh_token grant |
| CORS errors | Ensure proper redirect URI |
| Invalid OData | Check filter syntax |

---

## Resources

- [Dynamics 365 Web API Documentation](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview)
- [OAuth 2.0 with Dynamics 365](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth)
- [OData Query Syntax](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-data-web-api)
- [DOO Builders League](https://built2.doo.ooo/)

---

*Last updated: August 2026*
