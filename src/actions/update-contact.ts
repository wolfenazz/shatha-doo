/**
 * `dynamics.update_contact` — write action (T2.5).
 *
 * Updates a contact via the Dynamics 365 Web API `PATCH /contacts(<contactid>)`
 * endpoint (docs/research/api-endpoints-auth.md §2.5). Only the fields present
 * in the input are sent; `contactid` is never part of the request body.
 * The Web API answers `204 No Content` on success; the connector reports the
 * acknowledged record id and a success flag.
 *
 * WRITE-ACTION SAFETY (requirements.md "Write Actions" standard):
 * - Approval:    REQUIRED — this action modifies an existing record.
 * - Idempotency: IDEMPOTENT — PATCH applies the same field values with no
 *                additional side effect, so re-sending converges to the same
 *                end state.
 * - Duplicates:  Not applicable — no new record is created.
 * - Retry:       SAFE — retrying a timed-out PATCH is harmless.
 *
 * Provider failures are normalized by the client's response interceptor to
 * `ConnectorError` and propagate unchanged; `error.requestId` carries the
 * `x-ms-request-id` from the failed request when available.
 */
import { ConnectorAction, ConnectorExecutionResult } from '../types';
import { Dynamics365Client } from '../client';
import { ConnectorError } from '../errors';
import { updateContactInputSchema, updateContactOutputSchema } from '../schemas';

/** GUID format used by Dynamics 365 primary keys (matches schema `$defs/guid`). */
const GUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Input for `dynamics.update_contact` (mirrors `updateContactInputSchema`). */
export interface UpdateContactInput {
  contactid: string;
  firstname?: string;
  lastname?: string;
  emailaddress1?: string;
  telephone1?: string;
  companyname?: string;
}

/** The PATCH body — every updatable field except the primary key. */
export type UpdateContactFields = Omit<UpdateContactInput, 'contactid'>;

/** Returns `value[key]` as a trimmed string, throwing when mistyped. */
function optionalString(
  value: Record<string, unknown>,
  key: keyof UpdateContactFields,
): string | undefined {
  const raw = value[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new ConnectorError(`update_contact: "${key}" must be a string`, 'VALIDATION_ERROR');
  }
  return raw;
}

/** Validates raw input and returns the record id plus the PATCH body. */
function parseUpdateContactInput(input: unknown): {
  contactid: string;
  fields: UpdateContactFields;
} {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConnectorError('update_contact: input must be an object', 'VALIDATION_ERROR');
  }
  const value = input as Record<string, unknown>;

  const contactid = value.contactid;
  if (typeof contactid !== 'string' || !GUID_PATTERN.test(contactid)) {
    throw new ConnectorError(
      'update_contact: "contactid" is required and must be a valid GUID',
      'VALIDATION_ERROR',
    );
  }

  const fields: UpdateContactFields = {};
  for (const key of [
    'firstname',
    'lastname',
    'emailaddress1',
    'telephone1',
    'companyname',
  ] as const) {
    const field = optionalString(value, key);
    if (field !== undefined) {
      fields[key] = field;
    }
  }
  if (Object.keys(fields).length === 0) {
    throw new ConnectorError(
      'update_contact: at least one field to update is required (e.g. firstname, lastname, emailaddress1, telephone1, companyname)',
      'VALIDATION_ERROR',
    );
  }

  return { contactid, fields };
}

/** Action definition for `dynamics.update_contact`. */
export const updateContactAction: ConnectorAction = {
  id: 'dynamics.update_contact',
  name: 'Update Contact',
  description:
    'Update an existing contact record in Dynamics 365 by contactid. Consequential write: approval is required. Idempotent (PATCH) and safe to retry.',
  type: 'write',
  approval: 'required',
  inputSchema: updateContactInputSchema,
  outputSchema: updateContactOutputSchema,
  examples: [
    {
      contactid: '11111111-1111-1111-1111-111111111111',
      firstname: 'Jane',
      companyname: 'Example Corp',
    },
  ],
};

/** Executes `dynamics.update_contact` against the Web API. */
export async function executeUpdateContact(
  client: Dynamics365Client,
  input: unknown,
): Promise<ConnectorExecutionResult> {
  const { contactid, fields } = parseUpdateContactInput(input);
  await client.patch(`/contacts(${contactid})`, fields);
  return {
    success: true,
    data: { contactid, success: true },
    metadata: {
      actionId: updateContactAction.id,
      approval: 'required',
      idempotency: 'Idempotent — PATCH of the same field values has no additional side effect.',
      retry: 'Safe to retry (idempotent PATCH).',
    },
  };
}
