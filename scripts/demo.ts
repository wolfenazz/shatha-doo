/**
 * Offline demo (v1.1.0) — proves the FULL Dynamics 365 connector stack
 * without a Microsoft 365 tenant or Azure AD environment.
 *
 * Boots the bundled mock sandbox (tests/sandbox/dynamics-sandbox.ts) which
 * simulates the Dataverse Web API v9.2 + the Microsoft identity v2.0 token
 * endpoint, then drives the REAL production path:
 *
 *   MCP client -> MCP server -> connector.execute -> OAuth -> Web API client
 *
 * Run:  npm run build && npm run demo   (or just `npm run demo`)
 */
import { startSandbox, type SandboxServer } from '../tests/sandbox/dynamics-sandbox';
import { Dynamics365Connector } from '../src/connector';
import { createMcpServer } from '../mcp/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

interface DemoStep {
  name: string;
  pass: boolean;
  ms: number;
  detail?: string;
}

function fmtMs(started: number): number {
  return Date.now() - started;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  if (!('content' in result) || !Array.isArray(result.content)) {
    return '';
  }
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('');
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  text: string;
  isError: boolean;
}> {
  const result = await client.callTool({ name, arguments: args });
  return { text: textOf(result), isError: result.isError === true };
}

async function main(): Promise<void> {
  console.log('==========================================================');
  console.log('  Dynamics 365 Connector — offline end-to-end demo (v1.1.0)');
  console.log('==========================================================\n');

  const steps: DemoStep[] = [];
  const sandbox: SandboxServer = await startSandbox();
  console.log(`[sandbox] Mock Dynamics 365 (Dataverse v9.2) listening at ${sandbox.url}\n`);

  try {
    // ---- Step 1: testConnection -> WhoAmI probe -------------------------
    {
      const started = Date.now();
      const connector = new Dynamics365Connector({ allowLocalhost: true });
      const result = await connector.testConnection({
        orgUrl: sandbox.url,
        accessToken: 'sandbox-demo-token',
      });
      const probe = result.details as { probe?: { status?: string; userId?: string } };
      steps.push({
        name: 'testConnection (WhoAmI probe)',
        pass: result.success && probe?.probe?.status === 'ok',
        ms: fmtMs(started),
        detail: `userId=${probe?.probe?.userId}`,
      });
    }

    // ---- Step 2: MCP handshake ------------------------------------------
    process.env.D365_ORG_URL = sandbox.url;
    process.env.D365_ACCESS_TOKEN = 'sandbox-demo-token';
    process.env.D365_WRITE_APPROVAL_TOKEN = 'sandbox-demo-approval';
    const server = createMcpServer(
      new Dynamics365Connector({
        allowLocalhost: true,
        approvalToken: 'sandbox-demo-approval',
      }),
    );
    const client = new Client({ name: 'demo-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    {
      const started = Date.now();
      const { tools } = await client.listTools();
      steps.push({
        name: 'MCP initialize + tools/list',
        pass: tools.length === 5,
        ms: fmtMs(started),
        detail: `${tools.length} tools (${tools.map((t) => t.name).join(', ')})`,
      });
    }

    // ---- Step 3: the five actions through MCP tools ----------------------
    {
      const started = Date.now();
      const { text, isError } = await callTool(client, 'dynamics.create_contact', {
        _approvalToken: 'sandbox-demo-approval',
        firstname: 'Shatha',
        lastname: 'Demo',
        emailaddress1: 'shatha.demo@example.com',
        telephone1: '+1-555-0101',
      });
      const contactid = /"contactid"\s*:\s*"([0-9a-f-]{36})"/i.exec(text)?.[1];
      steps.push({
        name: 'dynamics.create_contact',
        pass: !isError && contactid !== undefined,
        ms: fmtMs(started),
        detail: `contactid=${contactid}`,
      });

      const searchStarted = Date.now();
      const search = await callTool(client, 'dynamics.search_contact', {
        query: 'Shatha',
        top: 5,
      });
      const found = /"count"\s*:\s*(\d+)/.exec(search.text)?.[1];
      steps.push({
        name: 'dynamics.search_contact',
        pass: !search.isError && Number(found ?? 0) >= 1,
        ms: fmtMs(searchStarted),
        detail: `${found} result(s)`,
      });

      const updateStarted = Date.now();
      const update = await callTool(client, 'dynamics.update_contact', {
        _approvalToken: 'sandbox-demo-approval',
        contactid,
        telephone1: '+1-555-0999',
      });
      steps.push({
        name: 'dynamics.update_contact',
        pass: !update.isError && contactid !== undefined,
        ms: fmtMs(updateStarted),
        detail: `contactid=${contactid} -> telephone1 updated`,
      });

      const leadStarted = Date.now();
      const lead = await callTool(client, 'dynamics.create_lead', {
        _approvalToken: 'sandbox-demo-approval',
        companyname: 'DOO Builders League',
        firstname: 'Shatha',
        lastname: 'Demo',
        emailaddress1: 'shatha.demo@example.com',
      });
      const leadid = /"leadid"\s*:\s*"([0-9a-f-]{36})"/i.exec(lead.text)?.[1];
      steps.push({
        name: 'dynamics.create_lead',
        pass: !lead.isError && leadid !== undefined,
        ms: fmtMs(leadStarted),
        detail: `leadid=${leadid}`,
      });

      const taskStarted = Date.now();
      const task = await callTool(client, 'dynamics.create_task', {
        _approvalToken: 'sandbox-demo-approval',
        subject: 'Follow up with the demo contact',
        description: 'Created by the offline demo — no tenant required',
        regardingobjectid: contactid,
      });
      const activityid = /"activityid"\s*:\s*"([0-9a-f-]{36})"/i.exec(task.text)?.[1];
      steps.push({
        name: 'dynamics.create_task',
        pass: !task.isError && activityid !== undefined,
        ms: fmtMs(taskStarted),
        detail: `activityid=${activityid}`,
      });

      await client.close();
      await server.close();
    }
  } finally {
    delete process.env.D365_ORG_URL;
    delete process.env.D365_ACCESS_TOKEN;
    delete process.env.D365_WRITE_APPROVAL_TOKEN;
    await sandbox.close();
  }

  // ---- Report -----------------------------------------------------------
  console.log('----------------------------------------------------------');
  const width = Math.max(...steps.map((s) => s.name.length)) + 2;
  for (const step of steps) {
    const status = step.pass ? 'PASS' : 'FAIL';
    console.log(
      `  ${status.padEnd(4)}  ${step.name.padEnd(width)} ${String(step.ms).padStart(5)} ms   ${step.detail ?? ''}`,
    );
  }
  console.log('----------------------------------------------------------');
  const passed = steps.filter((s) => s.pass).length;
  console.log(`  Result: ${passed}/${steps.length} checks passed`);
  if (passed < steps.length) {
    console.log('\n  One or more checks failed — see the FAIL rows above.\n');
    process.exitCode = 1;
    return;
  }
  console.log(
    '\n  The whole stack works offline: OAuth -> connector core -> MCP tools.\n' +
      '  The same code path runs against a real org once D365_ORG_URL + Azure\n' +
      '  credentials are provided (see .env.example and docs/SUBMISSION.md).\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
