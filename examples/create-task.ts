/**
 * Example: `dynamics.create_task`
 *
 * Demonstrates the write action that creates a task via `POST /tasks`
 * (docs/research/api-endpoints-auth.md §2.1/§2.5). `subject` is required;
 * `scheduledstart` / `scheduledend` are ISO-8601 date-time strings
 * (Edm.DateTimeOffset) and `regardingobjectid` links the task to a related
 * record (account, contact, lead, or opportunity).
 *
 * CONSEQUENTIAL WRITE — approval required (connector.yaml). See
 * src/schemas/index.ts `createTaskInputSchema`.
 *
 * Run: node examples/create-task.js (after `npm run build`)
 * NOTE: the connector core is a scaffold stub — `execute()` is implemented in
 *       M2/M3. This example documents the intended call contract.
 */
import { Dynamics365Connector } from '../src/connector';

async function main(): Promise<void> {
  const connector = new Dynamics365Connector();

  // Write action — requires explicit approval.
  const result = await connector.execute({
    actionId: 'dynamics.create_task',
    input: {
      subject: 'Follow up with John Doe',
      description: 'Call to discuss the proposal.',
      scheduledstart: '2026-08-10T09:00:00Z',
      scheduledend: '2026-08-10T09:30:00Z',
      regardingobjectid: '11111111-1111-1111-1111-111111111111',
    },
    metadata: {
      approvalToken: process.env.D365_WRITE_APPROVAL_TOKEN,
      requestId: 'example-create-task-001',
      retry: { idempotent: false },
    },
  });

  if (result.success) {
    console.log('Created task:', JSON.stringify(result.data, null, 2));
  } else {
    console.error('Create failed:', result.error);
  }
}

void main();
