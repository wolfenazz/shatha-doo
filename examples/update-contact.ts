/**
 * Example: `dynamics.update_contact`
 *
 * Demonstrates the write action that updates an existing contact via
 * `PATCH /contacts(<contactid>)` (docs/research/api-endpoints-auth.md §2.5).
 * Only the fields being changed are sent.
 *
 * CONSEQUENTIAL WRITE — approval required (connector.yaml). PATCH semantics
 * make the action idempotent: re-sending the same fields has no extra side
 * effect. See src/schemas/index.ts `updateContactInputSchema` (contactid
 * required, everything else optional).
 *
 * Run: node examples/update-contact.js (after `npm run build`)
 * NOTE: the connector core is a scaffold stub — `execute()` is implemented in
 *       M2/M3. This example documents the intended call contract.
 */
import { Dynamics365Connector } from '../src/connector';

async function main(): Promise<void> {
  const connector = new Dynamics365Connector();

  // Write action — requires explicit approval. contactid identifies the record.
  const result = await connector.execute({
    actionId: 'dynamics.update_contact',
    input: {
      contactid: '11111111-1111-1111-1111-111111111111',
      emailaddress1: 'john.doe.new@example.com',
      companyname: 'Example Corp (renamed)',
    },
    metadata: {
      approval: 'required',
      requestId: 'example-update-contact-001',
      retry: { idempotent: true }, // PATCH is idempotent
    },
  });

  if (result.success) {
    console.log('Updated contact:', JSON.stringify(result.data, null, 2));
  } else {
    console.error('Update failed:', result.error);
  }
}

void main();
