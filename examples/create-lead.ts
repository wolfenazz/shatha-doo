/**
 * Example: `dynamics.create_lead`
 *
 * Demonstrates the write action that creates a lead via `POST /leads`
 * (docs/research/api-endpoints-auth.md §2.1/§2.5).
 *
 * CONSEQUENTIAL WRITE — approval required (connector.yaml). `companyname` is
 * required (Dynamics requires a company on leads), see
 * src/schemas/index.ts `createLeadInputSchema`.
 *
 * Run: node examples/create-lead.js (after `npm run build`)
 * NOTE: the connector core is a scaffold stub — `execute()` is implemented in
 *       M2/M3. This example documents the intended call contract.
 */
import { Dynamics365Connector } from '../src/connector';

async function main(): Promise<void> {
  const connector = new Dynamics365Connector();

  // Write action — requires explicit approval.
  const result = await connector.execute({
    actionId: 'dynamics.create_lead',
    input: {
      firstname: 'Bob',
      lastname: 'Wilson',
      emailaddress1: 'bob.wilson@potential.com',
      companyname: 'Potential Client Inc',
      subject: 'Interested in services',
    },
    metadata: {
      approvalToken: process.env.D365_WRITE_APPROVAL_TOKEN,
      requestId: 'example-create-lead-001',
      retry: { idempotent: false },
    },
  });

  if (result.success) {
    console.log('Created lead:', JSON.stringify(result.data, null, 2));
  } else {
    console.error('Create failed:', result.error);
  }
}

void main();
