/**
 * Mock contact fixtures for tests (S3.3.1).
 *
 * Field names follow the Dynamics 365 Web API entity schema exactly as
 * documented in docs/research/api-endpoints-auth.md §2.3: `contactid`,
 * `firstname`, `lastname`, `emailaddress1`, `telephone1`, `companyname`
 * — NOT camelCase renames. GUIDs are test-only placeholders.
 */

/** A Dynamics 365 Contact record as returned by the Web API. */
export interface Contact {
  contactid: string;
  firstname: string;
  lastname: string;
  emailaddress1: string;
  telephone1: string;
  companyname: string;
}

/** Two mock contacts with test-only GUIDs. */
export const mockContacts: Contact[] = [
  {
    contactid: '11111111-1111-1111-1111-111111111111',
    firstname: 'John',
    lastname: 'Doe',
    emailaddress1: 'john.doe@example.com',
    telephone1: '+1-555-0101',
    companyname: 'Example Corp',
  },
  {
    contactid: '22222222-2222-2222-2222-222222222222',
    firstname: 'Jane',
    lastname: 'Smith',
    emailaddress1: 'jane.smith@example.com',
    telephone1: '+1-555-0102',
    companyname: 'Another Corp',
  },
];

/** A single mock contact (first fixture) for one-record tests. */
export const mockContact: Contact = mockContacts[0];
