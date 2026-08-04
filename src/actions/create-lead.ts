/**
 * `dynamics.create_lead` — write action (T2.6).
 *
 * Creates a lead via the Dynamics 365 Web API `POST /leads` endpoint
 * (docs/research/api-endpoints-auth.md §2.5) with `Prefer: return=representation`
 * so the created record — including the new `leadid` — is returned.
 * `companyname` is required (Dynamics 365 requires a company on leads).
 *
 * WRITE-ACTION SAFETY (requirements.md "Write Actions" standard):
 * - Approval:    REQUIRED — this action creates data in the Dynamics 365 org.
 * - Idempotency: NOT idempotent — every call creates a NEW lead record.
 * - Duplicates:  Dynamics 365 suppresses duplicate detection by default; callers
 *                should search existing leads before creating to dedupe.
 * - Retry:       NOT retry-safe — retrying a timed-out call may create a second
 *                record. Verify by leadid / search before re-sending.
 *
 * Provider failures are normalized by the client's response interceptor to
 * `ConnectorError` and propagate unchanged; `error.requestId` carries the
 * `x-ms-request-id` from the failed request when available.
 */
import { ConnectorAction, ConnectorExecutionResult } from '../types';
import { Dynamics365Client } from '../client';
import { ConnectorError } from '../errors';
import { createLeadInputSchema, createLeadOutputSchema } from '../schemas';

/** Input for `dynamics.create_lead` (mirrors `createLeadInputSchema`). */
export interface CreateLeadInput {
  firstname?: string;
  lastname?: string;
  emailaddress1?: string;
  companyname: string;
  subject?: string;
}

/** Created lead returned by the Web API (with `leadid`). */
export interface CreatedLead {
  '@odata.context'?: string;
  leadid: string;
  firstname?: string;
  lastname?: string;
  fullname?: string;
  emailaddress1?: string;
  companyname?: string;
  subject?: string;
}

/** Returns `value[key]` as a trimmed string, throwing when mistyped. */
function optionalString(
  value: Record<string, unknown>,
  key: keyof Omit<CreateLeadInput, 'companyname'>,
): string | undefined {
  const raw = value[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new ConnectorError(`create_lead: "${key}" must be a string`, 'VALIDATION_ERROR');
  }
  return raw;
}

/** Validates raw input; `companyname` is required. */
function parseCreateLeadInput(input: unknown): CreateLeadInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConnectorError('create_lead: input must be an object', 'VALIDATION_ERROR');
  }
  const value = input as Record<string, unknown>;

  const companyname = value.companyname;
  if (typeof companyname !== 'string' || companyname.trim().length === 0) {
    throw new ConnectorError(
      'create_lead: "companyname" is required (Dynamics 365 requires a company on leads)',
      'VALIDATION_ERROR',
    );
  }

  return {
    companyname,
    ...(value.firstname !== undefined ? { firstname: optionalString(value, 'firstname') } : {}),
    ...(value.lastname !== undefined ? { lastname: optionalString(value, 'lastname') } : {}),
    ...(value.emailaddress1 !== undefined
      ? { emailaddress1: optionalString(value, 'emailaddress1') }
      : {}),
    ...(value.subject !== undefined ? { subject: optionalString(value, 'subject') } : {}),
  };
}

/** Action definition for `dynamics.create_lead`. */
export const createLeadAction: ConnectorAction = {
  id: 'dynamics.create_lead',
  name: 'Create Lead',
  description:
    'Create a new lead record in Dynamics 365. Consequential write: approval is required. Not idempotent — each call creates a new record; not retry-safe (duplicates may occur).',
  type: 'write',
  approval: 'required',
  inputSchema: createLeadInputSchema,
  outputSchema: createLeadOutputSchema,
  examples: [
    {
      firstname: 'Bob',
      lastname: 'Wilson',
      emailaddress1: 'bob.wilson@potential.com',
      companyname: 'Potential Client Inc',
      subject: 'Interested in services',
    },
  ],
};

/** Executes `dynamics.create_lead` against the Web API. */
export async function executeCreateLead(
  client: Dynamics365Client,
  input: unknown,
): Promise<ConnectorExecutionResult> {
  const body = parseCreateLeadInput(input);
  const created = await client.post<CreatedLead>('/leads', body, { preferReturn: true });
  return {
    success: true,
    data: created,
    metadata: {
      actionId: createLeadAction.id,
      approval: 'required',
      idempotency: 'Not idempotent — every call creates a new lead record.',
      duplicateDetection: 'Disabled by default in Dynamics 365 (MSCRM.SuppressDuplicateDetection).',
      retry: 'Not retry-safe — verify by leadid before re-sending.',
    },
  };
}
