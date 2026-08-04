/**
 * Mock lead fixtures for tests (S3.3.2).
 *
 * Field names follow the Dynamics 365 Web API entity schema exactly as
 * documented in docs/research/api-endpoints-auth.md §2.3: `leadid`,
 * `firstname`, `lastname`, `emailaddress1`, `companyname`, `subject`
 * — NOT camelCase renames. GUIDs are test-only placeholders.
 */

/** A Dynamics 365 Lead record as returned by the Web API. */
export interface Lead {
  leadid: string;
  firstname: string;
  lastname: string;
  emailaddress1: string;
  companyname: string;
  subject: string;
}

/** Two mock leads with test-only GUIDs. */
export const mockLeads: Lead[] = [
  {
    leadid: '33333333-3333-3333-3333-333333333333',
    firstname: 'Bob',
    lastname: 'Wilson',
    emailaddress1: 'bob.wilson@potential.com',
    companyname: 'Potential Client Inc',
    subject: 'Interested in services',
  },
  {
    leadid: '44444444-4444-4444-4444-444444444444',
    firstname: 'Alice',
    lastname: 'Johnson',
    emailaddress1: 'alice.johnson@prospect.com',
    companyname: 'Prospect Partners LLC',
    subject: 'Requesting a product demo',
  },
];
