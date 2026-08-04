/**
 * JSON Schema (2020-12) definitions for all 5 Dynamics 365 connector actions.
 *
 * T1.2 Action Schema Design deliverables (S1.2.1 - S1.2.5):
 * - S1.2.1 `dynamics.search_contact`  → searchContact{Input,Output}Schema
 * - S1.2.2 `dynamics.create_contact`  → createContact{Input,Output}Schema
 * - S1.2.3 `dynamics.update_contact`  → updateContact{Input,Output}Schema
 * - S1.2.4 `dynamics.create_lead`     → createLead{Input,Output}Schema
 * - S1.2.5 `dynamics.create_task`     → createTask{Input,Output}Schema
 *
 * Field names follow the Dynamics 365 Web API entity definitions documented in
 * docs/research/api-endpoints-auth.md §2.3 (key fields per entity), §2.4
 * (query options) and §2.5 (create/update behavior). Every schema uses the
 * JSON Schema 2020-12 dialect and shares a reusable `$defs` block (GUID format
 * plus the canonical entity shapes) so each schema is self-contained and valid.
 *
 * Write actions (create_contact, update_contact, create_lead, create_task) are
 * consequential: approval is required (see connector.yaml) and callers must
 * document idempotency, duplicate-detection, and retry behavior (requirements.md
 * "Write Actions" standard).
 */

/** Reusable GUID schema (UUID-ish format) referenced as `#/$defs/guid`. */
const guidSchema = {
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  description: 'Dynamics 365 record identifier (GUID), e.g. 11111111-1111-1111-1111-111111111111.',
  examples: ['11111111-1111-1111-1111-111111111111'],
};

/**
 * Canonical Contact entity shape (entity set `contacts`).
 * Primary key: `contactid` (Edm.Guid).
 */
export const contactSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: { guid: guidSchema },
  type: 'object',
  properties: {
    contactid: {
      $ref: '#/$defs/guid',
      description: 'Primary key of the contact record (Edm.Guid).',
    },
    firstname: { type: 'string', description: 'First name of the contact.' },
    lastname: { type: 'string', description: 'Last name of the contact.' },
    fullname: {
      type: 'string',
      description: 'Read-only computed full name of the contact.',
    },
    emailaddress1: {
      type: 'string',
      description: 'Primary email address of the contact.',
    },
    telephone1: {
      type: 'string',
      description: 'Primary phone number of the contact.',
    },
    companyname: {
      type: 'string',
      description: 'Company / account name the contact belongs to.',
    },
  },
  required: ['contactid'],
  additionalProperties: false,
  examples: [
    {
      contactid: '11111111-1111-1111-1111-111111111111',
      firstname: 'John',
      lastname: 'Doe',
      fullname: 'John Doe',
      emailaddress1: 'john.doe@example.com',
      telephone1: '+1-555-0101',
      companyname: 'Example Corp',
    },
  ],
};

/**
 * Canonical Lead entity shape (entity set `leads`).
 * Primary key: `leadid` (Edm.Guid).
 */
export const leadSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: { guid: guidSchema },
  type: 'object',
  properties: {
    leadid: {
      $ref: '#/$defs/guid',
      description: 'Primary key of the lead record (Edm.Guid).',
    },
    firstname: { type: 'string', description: 'First name of the lead.' },
    lastname: { type: 'string', description: 'Last name of the lead.' },
    fullname: {
      type: 'string',
      description: 'Read-only computed full name of the lead.',
    },
    emailaddress1: {
      type: 'string',
      description: 'Primary email address of the lead.',
    },
    companyname: {
      type: 'string',
      description: 'Company name associated with the lead (required on create).',
    },
    subject: { type: 'string', description: 'Subject or summary of the lead.' },
  },
  required: ['leadid'],
  additionalProperties: false,
  examples: [
    {
      leadid: '33333333-3333-3333-3333-333333333333',
      firstname: 'Bob',
      lastname: 'Wilson',
      fullname: 'Bob Wilson',
      emailaddress1: 'bob.wilson@potential.com',
      companyname: 'Potential Client Inc',
      subject: 'Interested in services',
    },
  ],
};

/**
 * Canonical Task entity shape (entity set `tasks`).
 * Primary key: `activityid` (Edm.Guid); primary name column: `subject`.
 */
export const taskSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: { guid: guidSchema },
  type: 'object',
  properties: {
    activityid: {
      $ref: '#/$defs/guid',
      description: 'Primary key of the task record (Edm.Guid).',
    },
    subject: {
      type: 'string',
      description: 'Primary name column — short summary of the task (required).',
    },
    description: { type: 'string', description: 'Detailed description of the task.' },
    scheduledstart: {
      type: 'string',
      format: 'date-time',
      description: 'Planned start of the task (ISO-8601 date-time).',
    },
    scheduledend: {
      type: 'string',
      format: 'date-time',
      description: 'Planned end of the task (ISO-8601 date-time).',
    },
    regardingobjectid: {
      $ref: '#/$defs/guid',
      description: 'Lookup to the related record (account, contact, lead, or opportunity).',
    },
  },
  required: ['activityid'],
  additionalProperties: false,
  examples: [
    {
      activityid: '44444444-4444-4444-4444-444444444444',
      subject: 'Follow up with John Doe',
      description: 'Call to discuss the proposal.',
      scheduledstart: '2026-08-10T09:00:00Z',
      scheduledend: '2026-08-10T09:30:00Z',
      regardingobjectid: '11111111-1111-1111-1111-111111111111',
    },
  ],
};

/**
 * Shared `$defs` block — reused by every action schema via `#/$defs/...`.
 * - `guid`: Dynamics 365 record identifier (UUID-ish GUID).
 * - `contact` / `lead` / `task`: canonical entity shapes used in outputs.
 */
export const schemaDefs = {
  guid: guidSchema,
  contact: contactSchema,
  lead: leadSchema,
  task: taskSchema,
};

/**
 * S1.2.1 — `dynamics.search_contact` input schema.
 * Reads contacts via the Web API `GET /contacts` with OData query options
 * (docs/research/api-endpoints-auth.md §2.4).
 */
export const searchContactInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      description:
        "Search term matched against the contact full name (becomes `contains(fullname,'<query>')`).",
    },
    filter: {
      type: 'string',
      description:
        "Additional OData $filter expression to narrow results, e.g. `contains(fullname,'john') and emailaddress1 ne null`.",
    },
    top: {
      type: 'integer',
      minimum: 1,
      maximum: 5000,
      default: 10,
      description: 'Maximum number of contacts to return ($top, hard cap 5000).',
    },
    select: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Attributes to return per contact ($select), e.g. ["contactid","firstname","lastname","emailaddress1"]. Defaults to all contact fields.',
    },
  },
  required: ['query'],
  additionalProperties: false,
};

/**
 * S1.2.1 — `dynamics.search_contact` output schema.
 */
export const searchContactOutputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    contacts: {
      type: 'array',
      items: { $ref: '#/$defs/contact' },
      description: 'Matching contact records (the OData `value` array).',
    },
    count: {
      type: 'integer',
      minimum: 0,
      description: 'Number of contacts returned in this page.',
    },
    nextLink: {
      type: 'string',
      format: 'uri',
      description: 'OData `@odata.nextLink` URL for the next page, when pagination applies.',
    },
  },
  required: ['contacts', 'count'],
  additionalProperties: false,
  examples: [
    {
      contacts: [
        {
          contactid: '11111111-1111-1111-1111-111111111111',
          firstname: 'John',
          lastname: 'Doe',
          fullname: 'John Doe',
          emailaddress1: 'john.doe@example.com',
          telephone1: '+1-555-0101',
          companyname: 'Example Corp',
        },
      ],
      count: 1,
      nextLink: 'https://org.api.crm.dynamics.com/api/data/v9.2/contacts?$skiptoken=X%27AQAAA%27',
    },
  ],
};

/**
 * S1.2.2 — `dynamics.create_contact` input schema.
 * Consequential write: approval required. At least one of `firstname` /
 * `lastname` must be provided (anyOf). Fields map to `POST /contacts`.
 */
export const createContactInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    firstname: {
      type: 'string',
      description: 'First name of the contact. Required when lastname is absent.',
    },
    lastname: {
      type: 'string',
      description: 'Last name of the contact. Required when firstname is absent.',
    },
    emailaddress1: {
      type: 'string',
      description: 'Primary email address of the contact.',
    },
    telephone1: {
      type: 'string',
      description: 'Primary phone number of the contact.',
    },
    companyname: {
      type: 'string',
      description: 'Company / account name the contact belongs to.',
    },
  },
  anyOf: [{ required: ['firstname'] }, { required: ['lastname'] }],
  additionalProperties: false,
};

/**
 * S1.2.2 — `dynamics.create_contact` output schema.
 * Returns the created record (with `Prefer: return=representation`), including
 * the new `contactid` primary key.
 */
export const createContactOutputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    ...contactSchema.properties,
  },
  required: ['contactid'],
  additionalProperties: false,
  examples: [
    {
      contactid: '11111111-1111-1111-1111-111111111111',
      firstname: 'John',
      lastname: 'Doe',
      fullname: 'John Doe',
      emailaddress1: 'john.doe@example.com',
      telephone1: '+1-555-0101',
      companyname: 'Example Corp',
    },
  ],
};

/**
 * S1.2.3 — `dynamics.update_contact` input schema.
 * Consequential write: approval required. `contactid` identifies the record;
 * all other fields are optional PATCH updates (`PATCH /contacts(<contactid>)`).
 * PATCH semantics make the action idempotent — re-sending the same fields has
 * no additional side effect.
 */
export const updateContactInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    contactid: {
      $ref: '#/$defs/guid',
      description: 'Identifier of the contact record to update (primary key).',
    },
    firstname: {
      type: 'string',
      description: 'New first name. Omit to leave unchanged.',
    },
    lastname: {
      type: 'string',
      description: 'New last name. Omit to leave unchanged.',
    },
    emailaddress1: {
      type: 'string',
      description: 'New primary email address. Omit to leave unchanged.',
    },
    telephone1: {
      type: 'string',
      description: 'New primary phone number. Omit to leave unchanged.',
    },
    companyname: {
      type: 'string',
      description: 'New company / account name. Omit to leave unchanged.',
    },
  },
  required: ['contactid'],
  additionalProperties: false,
};

/**
 * S1.2.3 — `dynamics.update_contact` output schema.
 * The Web API returns 204 No Content on PATCH; the connector reports the
 * acknowledged record id and a success flag.
 */
export const updateContactOutputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    contactid: {
      $ref: '#/$defs/guid',
      description: 'Identifier of the contact record that was updated.',
    },
    success: {
      type: 'boolean',
      const: true,
      description: 'Always true when the update was acknowledged (204 No Content).',
    },
  },
  required: ['contactid', 'success'],
  additionalProperties: false,
  examples: [
    {
      contactid: '11111111-1111-1111-1111-111111111111',
      success: true,
    },
  ],
};

/**
 * S1.2.4 — `dynamics.create_lead` input schema.
 * Consequential write: approval required. `companyname` is required (Dynamics
 * requires a company on leads); other fields map to `POST /leads`.
 */
export const createLeadInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    firstname: {
      type: 'string',
      description: 'First name of the lead.',
    },
    lastname: {
      type: 'string',
      description: 'Last name of the lead.',
    },
    emailaddress1: {
      type: 'string',
      description: 'Primary email address of the lead.',
    },
    companyname: {
      type: 'string',
      description: 'Company name associated with the lead (required).',
    },
    subject: {
      type: 'string',
      description: 'Subject or summary of the lead.',
    },
  },
  required: ['companyname'],
  additionalProperties: false,
};

/**
 * S1.2.4 — `dynamics.create_lead` output schema.
 * Returns the created lead record, including the new `leadid` primary key.
 */
export const createLeadOutputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    ...leadSchema.properties,
  },
  required: ['leadid'],
  additionalProperties: false,
  examples: [
    {
      leadid: '33333333-3333-3333-3333-333333333333',
      firstname: 'Bob',
      lastname: 'Wilson',
      fullname: 'Bob Wilson',
      emailaddress1: 'bob.wilson@potential.com',
      companyname: 'Potential Client Inc',
      subject: 'Interested in services',
    },
  ],
};

/**
 * S1.2.5 — `dynamics.create_task` input schema.
 * Consequential write: approval required. `subject` is required; date-times
 * are ISO-8601 strings mapped to `scheduledstart` / `scheduledend`
 * (Edm.DateTimeOffset), and `regardingobjectid` links the task to a related
 * record. Fields map to `POST /tasks`.
 */
export const createTaskInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    subject: {
      type: 'string',
      minLength: 1,
      description: 'Primary name column — short summary of the task (required).',
    },
    description: {
      type: 'string',
      description: 'Detailed description of the task.',
    },
    scheduledstart: {
      type: 'string',
      format: 'date-time',
      description: 'Planned start of the task (ISO-8601 date-time).',
    },
    scheduledend: {
      type: 'string',
      format: 'date-time',
      description: 'Planned end of the task (ISO-8601 date-time).',
    },
    regardingobjectid: {
      $ref: '#/$defs/guid',
      description: 'Lookup to the related record (account, contact, lead, or opportunity).',
    },
  },
  required: ['subject'],
  additionalProperties: false,
};

/**
 * S1.2.5 — `dynamics.create_task` output schema.
 * Returns the created task record, including the new `activityid` primary key.
 */
export const createTaskOutputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: schemaDefs,
  type: 'object',
  properties: {
    ...taskSchema.properties,
  },
  required: ['activityid'],
  additionalProperties: false,
  examples: [
    {
      activityid: '44444444-4444-4444-4444-444444444444',
      subject: 'Follow up with John Doe',
      description: 'Call to discuss the proposal.',
      scheduledstart: '2026-08-10T09:00:00Z',
      scheduledend: '2026-08-10T09:30:00Z',
      regardingobjectid: '11111111-1111-1111-1111-111111111111',
    },
  ],
};

/**
 * Registry of input/output JSON Schemas for every connector action.
 * Keyed by the exact action IDs declared in connector.yaml.
 */
export const actionSchemas: {
  [actionId: string]: { input: object; output: object };
} = {
  'dynamics.search_contact': {
    input: searchContactInputSchema,
    output: searchContactOutputSchema,
  },
  'dynamics.create_contact': {
    input: createContactInputSchema,
    output: createContactOutputSchema,
  },
  'dynamics.update_contact': {
    input: updateContactInputSchema,
    output: updateContactOutputSchema,
  },
  'dynamics.create_lead': {
    input: createLeadInputSchema,
    output: createLeadOutputSchema,
  },
  'dynamics.create_task': {
    input: createTaskInputSchema,
    output: createTaskOutputSchema,
  },
};
