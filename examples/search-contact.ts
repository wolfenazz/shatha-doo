/**
 * Example: `dynamics.search_contact`
 *
 * Demonstrates the read action that searches contacts in Dynamics 365 via the
 * Web API `GET /contacts` endpoint with OData query options
 * (docs/research/api-endpoints-auth.md §2.4).
 *
 * Input shape (see src/schemas/index.ts `searchContactInputSchema`):
 *   { query: string (required), filter?: string, top?: int, select?: string[] }
 *
 * Run: node examples/search-contact.js (after `npm run build`)
 * NOTE: the connector core is a scaffold stub — `execute()` is implemented in
 *       M2/M3. This example documents the intended call contract.
 */
import { Dynamics365Connector } from '../src/connector';

async function main(): Promise<void> {
  const connector = new Dynamics365Connector();

  console.log(`Connector: ${connector.manifest.name} v${connector.manifest.version}`);
  console.log(
    `Registered actions: ${
      connector
        .listActions()
        .map((a) => a.id)
        .join(', ') || '(none yet — M2)'
    }`,
  );

  // Read action — no approval required.
  const result = await connector.execute({
    actionId: 'dynamics.search_contact',
    input: {
      query: 'John',
      top: 10,
      select: ['contactid', 'firstname', 'lastname', 'emailaddress1'],
    },
    metadata: { requestId: 'example-search-contact-001' },
  });

  if (result.success) {
    console.log('Search results:', JSON.stringify(result.data, null, 2));
  } else {
    console.error('Search failed:', result.error);
  }
}

void main();
