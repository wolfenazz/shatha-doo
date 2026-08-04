/**
 * Example: `dynamics.create_contact`
 *
 * Demonstrates the write action that creates a contact via `POST /contacts`
 * (docs/research/api-endpoints-auth.md §2.5).
 *
 * CONSEQUENTIAL WRITE — approval required (connector.yaml). At least one of
 * `firstname` / `lastname` must be provided (anyOf), see
 * src/schemas/index.ts `createContactInputSchema`.
 *
 * Run: node examples/create-contact.js (after `npm run build`)
 * NOTE: the connector core is a scaffold stub — `execute()` is implemented in
 *       M2/M3. This example documents the intended call contract.
 */
import { Dynamics365Connector } from '../src/connector';

async function main(): Promise<void> {
  const connector = new Dynamics365Connector();

  // Write action — requires explicit approval.
  const result = await connector.execute({
    actionId: 'dynamics.create_contact',
    input: {
      firstname: 'John',
      lastname: 'Doe',
      emailaddress1: 'john.doe@example.com',
      telephone1: '+1-555-0101',
      companyname: 'Example Corp',
    },
    metadata: {
      approval: 'required',
      requestId: 'example-create-contact-001',
      // Idempotency: retry-safe only if the caller passes the same payload.
      retry: { idempotent: false },
    },
  });

  if (result.success) {
    console.log('Created contact:', JSON.stringify(result.data, null, 2));
  } else {
    console.error('Create failed:', result.error);
  }
}

void main();
