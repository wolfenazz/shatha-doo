/**
 * Mock task fixtures for tests (S3.3.3).
 *
 * Field names follow the Dynamics 365 Web API entity schema exactly as
 * documented in docs/research/api-endpoints-auth.md §2.3: `activityid`
 * (primary key), `subject` (name column), `description`, `scheduledstart`,
 * `scheduledend` (ISO-8601), `regardingobjectid` (lookup GUID).
 * GUIDs are test-only placeholders.
 */

/** A Dynamics 365 Task (activity) record as returned by the Web API. */
export interface Task {
  activityid: string;
  subject: string;
  description: string;
  scheduledstart: string;
  scheduledend: string;
  regardingobjectid: string;
}

/** Two mock tasks with test-only GUIDs; regardingobjectid points at mock contacts. */
export const mockTasks: Task[] = [
  {
    activityid: '55555555-5555-5555-5555-555555555555',
    subject: 'Follow up with John Doe',
    description: 'Call to discuss the proposal.',
    scheduledstart: '2026-08-10T09:00:00Z',
    scheduledend: '2026-08-10T09:30:00Z',
    regardingobjectid: '11111111-1111-1111-1111-111111111111',
  },
  {
    activityid: '66666666-6666-6666-6666-666666666666',
    subject: 'Send contract to Jane Smith',
    description: 'Email the signed contract draft for review.',
    scheduledstart: '2026-08-11T14:00:00Z',
    scheduledend: '2026-08-11T14:15:00Z',
    regardingobjectid: '22222222-2222-2222-2222-222222222222',
  },
];
