/**
 * `dynamics.create_contact` — write action (T2.4).
 *
 * Creates a contact via the Dynamics 365 Web API `POST /contacts` endpoint
 * (docs/research/api-endpoints-auth.md §2.5) with `Prefer: return=representation`
 * so the created record — including the new `contactid` — is returned.
 *
 * WRITE-ACTION SAFETY (requirements.md "Write Actions" standard):
 * - Approval:    REQUIRED — this action creates data in the Dynamics 365 org.
 * - Idempotency: NOT idempotent — every call creates a NEW contact record.
 * - Duplicates:  Dynamics 365 suppresses duplicate detection by default; callers
 *                should search existing contacts before creating to dedupe.
 * - Retry:       NOT retry-safe — retrying a timed-out call may create a second
 *                record. Verify by contactid / search before re-sending.
 *
 * Provider failures are normalized by the client's response interceptor to
 * `ConnectorError` and propagate unchanged; `error.requestId` carries the
 * `x-ms-request-id` from the failed request when available.
 */
import { ConnectorAction, ConnectorExecutionResult } from '../types';
import { Dynamics365Client } from '../client';
import { ConnectorError } from '../errors';
import { createContactInputSchema, createContactOutputSchema } from '../schemas';

/** Input for `dynamics.create_contact` (mirrors `createContactInputSchema`). */
export interface CreateContactInput {
  firstname?: string;
  lastname?: string;
  emailaddress1?: string;
  telephone1?: string;
  companyname?: string;
}

/** Created contact returned by the Web API (with `contactid`). */
export interface CreatedContact {
  '@odata.context'?: string;
  contactid: string;
  firstname?: string;
  lastname?: string;
  fullname?: string;
  emailaddress1?: string;
  telephone1?: string;
  companyname?: string;
}

/** Returns `value[key]` as a trimmed string, throwing when mistyped. */
function optionalString(
  value: Record<string, unknown>,
  key: keyof CreateContactInput,
): string | undefined {
  const raw = value[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new ConnectorError(`create_contact: "${key}" must be a string`, 'VALIDATION_ERROR');
  }
  return raw;
}

/** Validates raw input; at least one of firstname/lastname must be present. */
function parseCreateContactInput(input: unknown): CreateContactInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConnectorError('create_contact: input must be an object', 'VALIDATION_ERROR');
  }
  const value = input as Record<string, unknown>;

  const firstname = optionalString(value, 'firstname');
  const lastname = optionalString(value, 'lastname');
  if (
    (firstname === undefined || firstname.trim().length === 0) &&
    (lastname === undefined || lastname.trim().length === 0)
  ) {
    throw new ConnectorError(
      'create_contact: at least one of "firstname" or "lastname" is required',
      'VALIDATION_ERROR',
    );
  }

  return {
    ...(firstname !== undefined ? { firstname } : {}),
    ...(lastname !== undefined ? { lastname } : {}),
    ...(value.emailaddress1 !== undefined
      ? { emailaddress1: optionalString(value, 'emailaddress1') }
      : {}),
    ...(value.telephone1 !== undefined ? { telephone1: optionalString(value, 'telephone1') } : {}),
    ...(value.companyname !== undefined
      ? { companyname: optionalString(value, 'companyname') }
      : {}),
  };
}

/** Action definition for `dynamics.create_contact`. */
export const createContactAction: ConnectorAction = {
  id: 'dynamics.create_contact',
  name: 'Create Contact',
  description:
    'Create a new contact record in Dynamics 365. Consequential write: approval is required. Not idempotent — each call creates a new record; not retry-safe (duplicates may occur).',
  type: 'write',
  approval: 'required',
  inputSchema: createContactInputSchema,
  outputSchema: createContactOutputSchema,
  examples: [
    {
      firstname: 'John',
      lastname: 'Doe',
      emailaddress1: 'john.doe@example.com',
      telephone1: '+1-555-0101',
      companyname: 'Example Corp',
    },
  ],
};

/** Executes `dynamics.create_contact` against the Web API. */
export async function executeCreateContact(
  client: Dynamics365Client,
  input: unknown,
): Promise<ConnectorExecutionResult> {
  const body = parseCreateContactInput(input);
  const created = await client.post<CreatedContact>('/contacts', body, { preferReturn: true });
  return {
    success: true,
    data: created,
    metadata: {
      actionId: createContactAction.id,
      approval: 'required',
      idempotency: 'Not idempotent — every call creates a new contact record.',
      duplicateDetection: 'Disabled by default in Dynamics 365 (MSCRM.SuppressDuplicateDetection).',
      retry: 'Not retry-safe — verify by contactid before re-sending.',
    },
  };
}
