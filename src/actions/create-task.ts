/**
 * `dynamics.create_task` — write action (T2.7).
 *
 * Creates a task via the Dynamics 365 Web API `POST /tasks` endpoint
 * (docs/research/api-endpoints-auth.md §2.5) with `Prefer: return=representation`
 * so the created record — including the new `activityid` — is returned.
 * `subject` is required (primary name column of the Task entity).
 *
 * WRITE-ACTION SAFETY (requirements.md "Write Actions" standard):
 * - Approval:    REQUIRED — this action creates data in the Dynamics 365 org.
 * - Idempotency: NOT idempotent — every call creates a NEW task record.
 * - Duplicates:  Dynamics 365 suppresses duplicate detection by default; callers
 *                should search existing tasks before creating to dedupe.
 * - Retry:       NOT retry-safe — retrying a timed-out call may create a second
 *                record. Verify by activityid / search before re-sending.
 *
 * Provider failures are normalized by the client's response interceptor to
 * `ConnectorError` and propagate unchanged; `error.requestId` carries the
 * `x-ms-request-id` from the failed request when available.
 */
import { ConnectorAction, ConnectorExecutionResult } from '../types';
import { Dynamics365Client } from '../client';
import { ConnectorError } from '../errors';
import { createTaskInputSchema, createTaskOutputSchema } from '../schemas';

/** GUID format used by Dynamics 365 primary keys (matches schema `$defs/guid`). */
const GUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Input for `dynamics.create_task` (mirrors `createTaskInputSchema`). */
export interface CreateTaskInput {
  subject: string;
  description?: string;
  scheduledstart?: string;
  scheduledend?: string;
  regardingobjectid?: string;
}

/** Created task returned by the Web API (with `activityid`). */
export interface CreatedTask {
  '@odata.context'?: string;
  activityid: string;
  subject?: string;
  description?: string;
  scheduledstart?: string;
  scheduledend?: string;
  regardingobjectid?: string;
}

/** Returns `value[key]` as a trimmed string, throwing when mistyped. */
function optionalString(
  value: Record<string, unknown>,
  key: keyof Omit<CreateTaskInput, 'subject'>,
): string | undefined {
  const raw = value[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new ConnectorError(`create_task: "${key}" must be a string`, 'VALIDATION_ERROR');
  }
  return raw;
}

/** Validates raw input; `subject` is required. */
function parseCreateTaskInput(input: unknown): CreateTaskInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConnectorError('create_task: input must be an object', 'VALIDATION_ERROR');
  }
  const value = input as Record<string, unknown>;

  const subject = value.subject;
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    throw new ConnectorError(
      'create_task: "subject" is required (primary name column of the Task entity)',
      'VALIDATION_ERROR',
    );
  }

  const regardingobjectid = optionalString(value, 'regardingobjectid');
  if (regardingobjectid !== undefined && !GUID_PATTERN.test(regardingobjectid)) {
    throw new ConnectorError(
      'create_task: "regardingobjectid" must be a valid GUID',
      'VALIDATION_ERROR',
    );
  }

  return {
    subject,
    ...(value.description !== undefined
      ? { description: optionalString(value, 'description') }
      : {}),
    ...(value.scheduledstart !== undefined
      ? { scheduledstart: optionalString(value, 'scheduledstart') }
      : {}),
    ...(value.scheduledend !== undefined
      ? { scheduledend: optionalString(value, 'scheduledend') }
      : {}),
    ...(regardingobjectid !== undefined ? { regardingobjectid } : {}),
  };
}

/** Action definition for `dynamics.create_task`. */
export const createTaskAction: ConnectorAction = {
  id: 'dynamics.create_task',
  name: 'Create Task',
  description:
    'Create a new task record in Dynamics 365. Consequential write: approval is required. Not idempotent — each call creates a new record; not retry-safe (duplicates may occur).',
  type: 'write',
  approval: 'required',
  inputSchema: createTaskInputSchema,
  outputSchema: createTaskOutputSchema,
  examples: [
    {
      subject: 'Follow up with John Doe',
      description: 'Call to discuss the proposal.',
      scheduledstart: '2026-08-10T09:00:00Z',
      scheduledend: '2026-08-10T09:30:00Z',
      regardingobjectid: '11111111-1111-1111-1111-111111111111',
    },
  ],
};

/** Executes `dynamics.create_task` against the Web API. */
export async function executeCreateTask(
  client: Dynamics365Client,
  input: unknown,
): Promise<ConnectorExecutionResult> {
  const body = parseCreateTaskInput(input);
  const created = await client.post<CreatedTask>('/tasks', body, { preferReturn: true });
  return {
    success: true,
    data: created,
    metadata: {
      actionId: createTaskAction.id,
      approval: 'required',
      idempotency: 'Not idempotent — every call creates a new task record.',
      duplicateDetection: 'Disabled by default in Dynamics 365 (MSCRM.SuppressDuplicateDetection).',
      retry: 'Not retry-safe — verify by activityid before re-sending.',
    },
  };
}
