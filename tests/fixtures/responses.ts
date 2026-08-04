/**
 * Mock Dynamics 365 Web API responses for tests (S3.3.4).
 *
 * Response envelope shapes follow docs/research/api-endpoints-auth.md:
 *  - §2.4 query envelope: `value` + `@odata.nextLink`
 *  - §2.5 create body (with `Prefer: return=representation`)
 *  - §2.6 WhoAmI() response used by testConnection
 *  - OData error envelope used by error normalization
 */

import { Contact, mockContact, mockContacts } from './contacts';

/** OData query response envelope (paginated). */
export interface QueryResponse<T> {
  '@odata.context': string;
  value: T[];
  '@odata.nextLink'?: string;
}

/** Create response body — `@odata.context` plus the created record fields. */
export type CreateResponse = Contact & {
  '@odata.context': string;
};

/** WhoAmI() function response used by testConnection. */
export interface WhoAmIResponse {
  BusinessUnitId: string;
  UserId: string;
  OrganizationId: string;
}

/** OData error envelope (`error.code`, `error.message`). */
export interface ODataError {
  code: string;
  message: string;
}

/** Full OData error response body. */
export interface ODataErrorResponse {
  error: ODataError;
}

/** Mock paginated query response for `dynamics.search_contact`. */
export const mockQueryResponse: QueryResponse<Contact> = {
  '@odata.context':
    'https://contoso.api.crm.dynamics.com/api/data/v9.2/$metadata#contacts(firstname,lastname)',
  value: [...mockContacts],
  '@odata.nextLink':
    'https://contoso.api.crm.dynamics.com/api/data/v9.2/contacts?$skiptoken=X%271234%27',
};

/** Mock 201 Created body (return=representation) for `dynamics.create_contact`. */
export const mockCreateResponse: CreateResponse = {
  '@odata.context': 'https://contoso.api.crm.dynamics.com/api/data/v9.2/$metadata#contacts/$entity',
  ...mockContact,
};

/** Mock WhoAmI() response for testConnection. */
export const mockWhoAmIResponse: WhoAmIResponse = {
  BusinessUnitId: '88888888-8888-8888-8888-888888888888',
  UserId: '77777777-7777-7777-7777-777777777777',
  OrganizationId: '99999999-9999-9999-9999-999999999999',
};

/** Mock OData error envelope (e.g. 400 Bad Request). */
export const mockODataError: ODataErrorResponse = {
  error: {
    code: '0x80040203',
    message: 'A required attribute is missing from the record.',
  },
};
