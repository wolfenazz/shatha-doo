/**
 * `dynamics.search_contact` — read action (T2.3).
 *
 * Searches contacts via the Dynamics 365 Web API `GET /contacts` endpoint with
 * OData query options (docs/research/api-endpoints-auth.md §2.4):
 *  - `query`  → `$filter=contains(fullname,'<query>')` (single quotes escaped)
 *  - `filter` → additional OData `$filter` expression, AND-ed with `query`
 *  - `top`    → `$top` page size (default 10, hard cap 5000)
 *  - `select` → `$select` comma-joined attribute list
 *
 * Read action: no approval required. GET is side-effect free and safe to retry.
 * Provider failures are normalized by the client's response interceptor to
 * `ConnectorError` and propagate unchanged (never double-wrapped); the
 * `requestId` of a failed request is available as `error.requestId`.
 */
import { ConnectorAction, ConnectorExecutionResult } from '../types';
import { Dynamics365Client } from '../client';
import { ConnectorError } from '../errors';
import { searchContactInputSchema, searchContactOutputSchema } from '../schemas';

/** Hard server cap for `$top` (research §2.4, api-limits doc). */
const MAX_TOP = 5000;

/** Default page size when `top` is omitted (matches `searchContactInputSchema`). */
const DEFAULT_TOP = 10;

/** Input for `dynamics.search_contact` (mirrors `searchContactInputSchema`). */
export interface SearchContactInput {
  query?: string;
  nextLink?: string;
  filter?: string;
  top?: number;
  select?: string[];
}

/** A contact row returned by the Web API (known fields; $select may add more). */
export interface ContactRecord {
  contactid?: string;
  firstname?: string;
  lastname?: string;
  fullname?: string;
  emailaddress1?: string;
  telephone1?: string;
  companyname?: string;
}

/** OData list query response envelope (research §2.4). */
interface ODataListResponse<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

/** Escapes an OData string literal by doubling single quotes (OData ABNF). */
function escapeODataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Validates raw input and returns a typed, capped `SearchContactInput`. */
function parseSearchInput(input: unknown): SearchContactInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConnectorError('search_contact: input must be an object', 'VALIDATION_ERROR');
  }
  const value = input as Record<string, unknown>;

  const query = value.query;
  const nextLink = value.nextLink;
  if (
    (typeof query !== 'string' || query.trim().length === 0) &&
    (typeof nextLink !== 'string' || nextLink.trim().length === 0)
  ) {
    throw new ConnectorError(
      'search_contact: either "query" or "nextLink" is required',
      'VALIDATION_ERROR',
    );
  }

  let top = DEFAULT_TOP;
  if (value.top !== undefined) {
    if (typeof value.top !== 'number' || !Number.isInteger(value.top) || value.top < 1) {
      throw new ConnectorError(
        'search_contact: "top" must be a positive integer',
        'VALIDATION_ERROR',
      );
    }
    top = Math.min(value.top, MAX_TOP);
  }

  let select: string[] | undefined;
  if (value.select !== undefined) {
    if (
      !Array.isArray(value.select) ||
      value.select.some((s) => typeof s !== 'string' || s.trim().length === 0)
    ) {
      throw new ConnectorError(
        'search_contact: "select" must be an array of attribute names',
        'VALIDATION_ERROR',
      );
    }
    select = value.select as string[];
  }

  let filter: string | undefined;
  if (value.filter !== undefined) {
    if (typeof value.filter !== 'string' || value.filter.trim().length === 0) {
      throw new ConnectorError(
        'search_contact: "filter" must be a non-empty OData $filter expression',
        'VALIDATION_ERROR',
      );
    }
    filter = value.filter;
  }

  return {
    ...(typeof query === 'string' ? { query } : {}),
    ...(typeof nextLink === 'string' ? { nextLink } : {}),
    top,
    select,
    filter,
  };
}

/** Action definition for `dynamics.search_contact`. */
export const searchContactAction: ConnectorAction = {
  id: 'dynamics.search_contact',
  name: 'Search Contact',
  description:
    'Search for contacts in Dynamics 365 by full name (OData contains) with optional filter, page size, and column selection. Read-only, no approval required.',
  type: 'read',
  inputSchema: searchContactInputSchema,
  outputSchema: searchContactOutputSchema,
  examples: [
    { query: 'John', top: 10, select: ['contactid', 'firstname', 'lastname', 'emailaddress1'] },
    { query: 'Acme', filter: 'telephone1 ne null', top: 25 },
  ],
};

/**
 * Executes `dynamics.search_contact` against the Web API.
 *
 * The connector core (src/connector.ts) wires handlers under the
 * `searchContactHandler` name; this alias keeps both contracts aligned.
 */
export const searchContactHandler = executeSearchContact;

/** Executes `dynamics.search_contact` against the Web API. */
export async function executeSearchContact(
  client: Dynamics365Client,
  input: unknown,
): Promise<ConnectorExecutionResult> {
  const { query, nextLink: requestedNextLink, top, select, filter } = parseSearchInput(input);

  if (requestedNextLink) {
    const page = await client.getNextPage<ODataListResponse<ContactRecord>>(requestedNextLink);
    const contacts = Array.isArray(page.data.value) ? page.data.value : [];
    const nextLink = page.data['@odata.nextLink'];
    return {
      success: true,
      data: { contacts, count: contacts.length, nextLink },
      metadata: {
        actionId: searchContactAction.id,
        pagination: { returned: contacts.length, hasNextPage: Boolean(nextLink) },
        rateLimit: page.metadata.rateLimit ?? { observed: false },
        ...page.metadata,
      },
    };
  }

  const filterParts = [`contains(fullname,'${escapeODataLiteral(query as string)}')`];
  if (filter) {
    filterParts.push(filter);
  }
  const params: Record<string, unknown> = { $filter: filterParts.join(' and '), $top: top };
  if (select && select.length > 0) {
    params.$select = select.join(',');
  }

  const response =
    typeof client.getWithMetadata === 'function'
      ? await client.getWithMetadata<ODataListResponse<ContactRecord>>('/contacts', params)
      : {
          data: await client.get<ODataListResponse<ContactRecord>>('/contacts', params),
          metadata: {},
        };
  const contacts = Array.isArray(response.data.value) ? response.data.value : [];
  const nextLink = response.data['@odata.nextLink'];

  return {
    success: true,
    data: { contacts, count: contacts.length, nextLink },
    metadata: {
      actionId: searchContactAction.id,
      pagination: {
        top,
        returned: contacts.length,
        hasNextPage: typeof nextLink === 'string' && nextLink.length > 0,
      },
      rateLimit: response.metadata.rateLimit ?? { observed: false },
      ...response.metadata,
    },
  };
}
