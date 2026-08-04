/**
 * Unit tests for src/actions/* — the five connector actions (T3.2 S3.2.3).
 *
 * The Dynamics365Client is fully mocked (jest.fn()s for get/post/patch/delete/
 * whoAmI) so NO real network calls occur. Validation failures are asserted via
 * the ConnectorError code (`VALIDATION_ERROR`); request shapes are asserted with
 * `toHaveBeenCalledWith` (exact OData params, body, and `{ preferReturn: true }`).
 */
import { Dynamics365Client } from '../src/client';
import {
  executeSearchContact,
  searchContactAction,
  searchContactHandler,
} from '../src/actions/search-contact';
import { executeCreateContact, createContactAction } from '../src/actions/create-contact';
import { executeUpdateContact, updateContactAction } from '../src/actions/update-contact';
import { executeCreateLead, createLeadAction } from '../src/actions/create-lead';
import { executeCreateTask, createTaskAction } from '../src/actions/create-task';

/** Fully mocked client — every verb is a jest.fn; cast for the class type. */
const client = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  whoAmI: jest.fn(),
} as unknown as Dynamics365Client;

const CONTACT_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '33333333-3333-3333-3333-333333333333';
const TASK_ID = '44444444-4444-4444-4444-444444444444';

describe('action definitions (T2.3-T2.7)', () => {
  it('uses the exact action ids and approval flags', () => {
    expect(searchContactAction).toMatchObject({
      id: 'dynamics.search_contact',
      name: 'Search Contact',
      type: 'read',
    });
    expect(createContactAction).toMatchObject({
      id: 'dynamics.create_contact',
      type: 'write',
      approval: 'required',
    });
    expect(updateContactAction).toMatchObject({
      id: 'dynamics.update_contact',
      type: 'write',
      approval: 'required',
    });
    expect(createLeadAction).toMatchObject({
      id: 'dynamics.create_lead',
      type: 'write',
      approval: 'required',
    });
    expect(createTaskAction).toMatchObject({
      id: 'dynamics.create_task',
      type: 'write',
      approval: 'required',
    });
  });

  it('exposes searchContactHandler as the connector-wired alias', () => {
    expect(searchContactHandler).toBe(executeSearchContact);
  });
});

describe('search_contact (S2.3.1-S2.3.3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the OData $filter from query with a default $top of 10', async () => {
    (client.get as jest.Mock).mockResolvedValueOnce({
      value: [{ contactid: CONTACT_ID, firstname: 'John', lastname: 'Doe' }],
      '@odata.nextLink':
        'https://org.api.crm.dynamics.com/api/data/v9.2/contacts?$skiptoken=X%27AQAAA%27',
    });

    const result = await executeSearchContact(client, { query: 'John' });

    expect(client.get).toHaveBeenCalledWith('/contacts', {
      $filter: "contains(fullname,'John')",
      $top: 10,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      contacts: [{ contactid: CONTACT_ID, firstname: 'John', lastname: 'Doe' }],
      count: 1,
      nextLink: 'https://org.api.crm.dynamics.com/api/data/v9.2/contacts?$skiptoken=X%27AQAAA%27',
    });
    expect(result.metadata).toMatchObject({
      actionId: 'dynamics.search_contact',
      pagination: { top: 10, returned: 1, hasNextPage: true },
      rateLimit: expect.any(Object),
    });
  });

  it('joins select into $select, ANDs a custom filter, and caps top at 5000', async () => {
    (client.get as jest.Mock).mockResolvedValueOnce({ value: [] });

    const result = await executeSearchContact(client, {
      query: 'Acme',
      filter: 'telephone1 ne null',
      top: 9999,
      select: ['contactid', 'firstname'],
    });

    expect(client.get).toHaveBeenCalledWith('/contacts', {
      $filter: "contains(fullname,'Acme') and telephone1 ne null",
      $top: 5000,
      $select: 'contactid,firstname',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ contacts: [], count: 0, nextLink: undefined });
    expect(result.metadata).toMatchObject({ pagination: { top: 5000, hasNextPage: false } });
  });

  it('escapes single quotes inside the query literal', async () => {
    (client.get as jest.Mock).mockResolvedValueOnce({ value: [] });
    await executeSearchContact(client, { query: "O'Brien" });
    expect(client.get).toHaveBeenCalledWith('/contacts', {
      $filter: "contains(fullname,'O''Brien')",
      $top: 10,
    });
  });

  it('rejects a missing query with VALIDATION_ERROR', async () => {
    await expect(executeSearchContact(client, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(client.get).not.toHaveBeenCalled();
  });
});

describe('create_contact (S2.4.1-S2.4.3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs the body with preferReturn and returns the created record', async () => {
    (client.post as jest.Mock).mockResolvedValueOnce({
      '@odata.context':
        'https://contoso.api.crm.dynamics.com/api/data/v9.2/$metadata#contacts/$entity',
      contactid: CONTACT_ID,
      firstname: 'John',
      lastname: 'Doe',
      fullname: 'John Doe',
    });

    const result = await executeCreateContact(client, { firstname: 'John', lastname: 'Doe' });

    expect(client.post).toHaveBeenCalledWith(
      '/contacts',
      { firstname: 'John', lastname: 'Doe' },
      { preferReturn: true },
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ contactid: CONTACT_ID, fullname: 'John Doe' });
    expect(result.metadata).toMatchObject({
      actionId: 'dynamics.create_contact',
      approval: 'required',
    });
  });

  it('rejects when neither firstname nor lastname is present', async () => {
    await expect(
      executeCreateContact(client, { emailaddress1: 'x@example.com' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(client.post).not.toHaveBeenCalled();
  });
});

describe('update_contact (S2.5.1-S2.5.3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PATCHes /contacts(<contactid>) and omits contactid from the body', async () => {
    (client.patch as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await executeUpdateContact(client, { contactid: CONTACT_ID, firstname: 'Jane' });

    expect(client.patch).toHaveBeenCalledWith(`/contacts(${CONTACT_ID})`, { firstname: 'Jane' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ contactid: CONTACT_ID, success: true });
    expect(result.metadata).toMatchObject({
      actionId: 'dynamics.update_contact',
      approval: 'required',
      idempotency: expect.stringContaining('Idempotent'),
    });
  });

  it('rejects a missing contactid with VALIDATION_ERROR', async () => {
    await expect(executeUpdateContact(client, { firstname: 'Jane' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(client.patch).not.toHaveBeenCalled();
  });
});

describe('create_lead (S2.6.1-S2.6.3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires companyname (VALIDATION_ERROR when absent)', async () => {
    await expect(executeCreateLead(client, { firstname: 'Bob' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('POSTs /leads with preferReturn and returns the created lead', async () => {
    (client.post as jest.Mock).mockResolvedValueOnce({ leadid: LEAD_ID, companyname: 'Acme Inc' });

    const result = await executeCreateLead(client, {
      companyname: 'Acme Inc',
      subject: 'Interested',
    });

    expect(client.post).toHaveBeenCalledWith(
      '/leads',
      { companyname: 'Acme Inc', subject: 'Interested' },
      { preferReturn: true },
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ leadid: LEAD_ID, companyname: 'Acme Inc' });
    expect(result.metadata).toMatchObject({
      actionId: 'dynamics.create_lead',
      approval: 'required',
    });
  });
});

describe('create_task (S2.7.1-S2.7.3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires subject (VALIDATION_ERROR when absent)', async () => {
    await expect(executeCreateTask(client, { description: 'no subject' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('POSTs /tasks with preferReturn and returns the created task', async () => {
    (client.post as jest.Mock).mockResolvedValueOnce({ activityid: TASK_ID, subject: 'Follow up' });

    const result = await executeCreateTask(client, {
      subject: 'Follow up',
      regardingobjectid: CONTACT_ID,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/tasks',
      { subject: 'Follow up', regardingobjectid: CONTACT_ID },
      { preferReturn: true },
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ activityid: TASK_ID, subject: 'Follow up' });
    expect(result.metadata).toMatchObject({
      actionId: 'dynamics.create_task',
      approval: 'required',
    });
  });
});
