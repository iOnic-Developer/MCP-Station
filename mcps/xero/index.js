// mcps/xero/index.js — Xero accounting + payroll for MCP Station.
// Auth: Xero Custom Connection (OAuth2 client_credentials) — the same flow Xero's official
// MCP server uses. Token cached in module scope (~30 min TTL), tenant auto-detected from
// GET /connections (override with the tenant_id setting).
// Accounting API  → https://api.xero.com/api.xro/2.0   (PascalCase envelopes: { Invoices: [...] })
// Payroll UK/NZ   → https://api.xero.com/payroll.xro/2.0 (camelCase envelopes: { employees: [...] })

const API_BASE = 'https://api.xero.com';
const IDENTITY_BASE = 'https://identity.xero.com';
const MAX_OUTPUT = 24000;

// Module-scope token cache — survives across requests until the module is reloaded.
let _auth = { key: '', token: null, exp: 0, tenant: null };

function clip(md) {
  if (md.length <= MAX_OUTPUT) return md;
  return md.slice(0, MAX_OUTPUT) + '\n\n…(output truncated — narrow with filters/page args)';
}

// Xero Accounting API serialises some dates as "/Date(1518685950940+0000)/"
function xDate(v) {
  if (!v) return '—';
  const m = String(v).match(/\/Date\((\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function money(n, cur = '') {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${cur}${Number(n).toFixed(2)}`;
}

// Generic renderer for Xero report payloads ({ Reports: [{ ReportTitles, Rows: [...] }] })
function renderReport(rep) {
  if (!rep) return 'No report returned.';
  let md = `### ${(rep.ReportTitles || [rep.ReportName]).filter(Boolean).join(' — ')}\n\n`;
  const walk = (rows, depth = 0) => {
    for (const row of rows || []) {
      if (row.RowType === 'Header') {
        md += '| ' + (row.Cells || []).map((c) => c.Value ?? '').join(' | ') + ' |\n';
        md += '|' + (row.Cells || []).map(() => '---').join('|') + '|\n';
      } else if (row.RowType === 'Section') {
        if (row.Title) md += `\n**${row.Title}**\n\n`;
        walk(row.Rows, depth + 1);
      } else {
        const cells = (row.Cells || []).map((c) => c.Value ?? '').join(' | ');
        md += `| ${row.RowType === 'SummaryRow' ? '**' : ''}${cells}${row.RowType === 'SummaryRow' ? '**' : ''} |\n`;
      }
    }
  };
  walk(rep.Rows);
  return md;
}

export function register({ server, z, getSettings, log, fetchJson }) {
  const form = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  async function token() {
    const { client_id, client_secret, scopes, tenant_id } = getSettings();
    if (!client_id || !client_secret) {
      throw new Error('client_id / client_secret are not configured. Open MCP Station → Xero → Settings (create a Custom Connection at developer.xero.com).');
    }
    const now = Date.now();
    if (_auth.token && _auth.key === client_id && now < _auth.exp) return _auth;

    // btoa is a Node 18+ global
    const basic = btoa(`${client_id}:${client_secret}`);
    let tok;
    try {
      tok = await fetchJson(`${IDENTITY_BASE}/connect/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: form({ grant_type: 'client_credentials', ...(scopes ? { scope: scopes } : {}) })
      });
    } catch (e) {
      log(`xero: token request failed — ${e.message}`);
      throw new Error(`Xero token request failed: ${e.message}. Check client_id/client_secret, and that the Scopes setting only lists scopes ticked on the Custom Connection (invalid_scope = mismatch; unauthorized_client = app not authorised for client_credentials).`);
    }

    let tenant = tenant_id || null;
    if (!tenant) {
      try {
        const conns = await fetchJson(`${API_BASE}/connections`, {
          headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Accept': 'application/json' }
        });
        tenant = Array.isArray(conns) && conns.length ? conns[0].tenantId : null;
      } catch (e) {
        log(`xero: /connections failed — ${e.message}`);
      }
    }

    _auth = {
      key: client_id,
      token: tok.access_token,
      exp: now + Math.max(60, (tok.expires_in || 1800) - 120) * 1000,
      tenant
    };
    return _auth;
  }

  // path starts with '/'; payroll=true → payroll.xro/2.0 (UK/NZ orgs), else api.xro/2.0
  async function api(path, { method = 'GET', body = null, payroll = false, retried = false } = {}) {
    const a = await token();
    const base = payroll ? `${API_BASE}/payroll.xro/2.0` : `${API_BASE}/api.xro/2.0`;
    try {
      return await fetchJson(`${base}${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${a.token}`,
          ...(a.tenant ? { 'Xero-Tenant-Id': a.tenant } : {}),
          'Accept': 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (e) {
      if (!retried && /401/.test(e.message || '')) {
        _auth = { key: '', token: null, exp: 0, tenant: null }; // token expired mid-flight — refresh once
        return api(path, { method, body, payroll, retried: true });
      }
      log(`xero: ${method} ${path} failed — ${e.message}`);
      const hint = /403/.test(e.message) ? ' (missing scope on the Custom Connection, or the org has no Payroll subscription)' :
        /404/.test(e.message) ? ' (check the ID; for payroll endpoints the org must be UK/NZ payroll)' : '';
      throw new Error(`Xero API error on ${method} ${path}: ${e.message}${hint}`);
    }
  }

  // Cuts registerTool boilerplate; every handler returns {text, data?} or a full result object.
  function tool(name, title, description, schema, annotations, handler) {
    server.registerTool(name, { title, description, inputSchema: schema, annotations }, async (args) => {
      try {
        const out = await handler(args);
        if (out && out.content) return out;
        return {
          content: [{ type: 'text', text: clip(out.text) }],
          ...(out.data !== undefined ? { structuredContent: out.data } : {})
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });
  }

  const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

  const lineItemSchema = z.array(z.object({
    description: z.string().describe('Line description'),
    quantity: z.number().default(1).describe('Quantity'),
    unit_amount: z.number().describe('Unit price'),
    account_code: z.string().optional().describe('Account code from xero_list_accounts (e.g. "200" sales)'),
    item_code: z.string().optional().describe('Optional item code from xero_list_items'),
    tax_type: z.string().optional().describe('Optional tax type from xero_list_tax_rates (e.g. OUTPUT2)')
  })).min(1).describe('Line items');

  const toLines = (items) => items.map((li) => ({
    Description: li.description, Quantity: li.quantity, UnitAmount: li.unit_amount,
    ...(li.account_code ? { AccountCode: li.account_code } : {}),
    ...(li.item_code ? { ItemCode: li.item_code } : {}),
    ...(li.tax_type ? { TaxType: li.tax_type } : {})
  }));

  // ───────────────────────── organisation & settings ─────────────────────────

  tool('xero_get_organisation', 'Get organisation',
    'The connected Xero organisation — name, country, base currency, financial year end, tax basics. Run this first to confirm the connection works.',
    {}, RO,
    async () => {
      const d = await api('/Organisation');
      const o = d?.Organisations?.[0];
      if (!o) return { text: 'Connected, but no organisation returned — check the Custom Connection is authorised against an org.' };
      const text = `### ${o.Name}\n\n| Field | Value |\n|---|---|\n| Legal name | ${o.LegalName || '—'} |\n| Country | ${o.CountryCode || '—'} |\n| Base currency | ${o.BaseCurrency || '—'} |\n| Financial year end | ${o.FinancialYearEndDay || '?'}/${o.FinancialYearEndMonth || '?'} |\n| Sales tax basis | ${o.SalesTaxBasis || '—'} |\n| Tax number | ${o.TaxNumber || '—'} |\n| Organisation type | ${o.OrganisationType || '—'} |`;
      return { text, data: o };
    });

  tool('xero_list_accounts', 'List accounts',
    'Chart of accounts — the account codes needed by invoice/transaction line items and payments.',
    { where: z.string().optional().describe('Optional raw Xero where filter, e.g. Type=="BANK"') }, RO,
    async ({ where }) => {
      const d = await api(`/Accounts${where ? `?where=${encodeURIComponent(where)}` : ''}`);
      const rows = (d?.Accounts || []).map((a) => `| \`${a.Code || '—'}\` | ${a.Name} | ${a.Type} | ${a.TaxType || '—'} | ${a.Status} |`);
      return { text: `### Accounts (${rows.length})\n\n| Code | Name | Type | Tax | Status |\n|---|---|---|---|---|\n${rows.join('\n')}`, data: { count: rows.length, accounts: d?.Accounts || [] } };
    });

  tool('xero_list_tax_rates', 'List tax rates',
    'Tax rates and their TaxType codes (used on line items).',
    {}, RO,
    async () => {
      const d = await api('/TaxRates');
      const rows = (d?.TaxRates || []).map((t) => `| \`${t.TaxType}\` | ${t.Name} | ${t.EffectiveRate ?? t.DisplayTaxRate ?? '—'}% | ${t.Status} |`);
      return { text: `### Tax rates (${rows.length})\n\n| TaxType | Name | Rate | Status |\n|---|---|---|---|\n${rows.join('\n')}`, data: d };
    });

  tool('xero_list_tracking_categories', 'List tracking categories',
    'Tracking categories and their options (departments, locations, …).',
    {}, RO,
    async () => {
      const d = await api('/TrackingCategories');
      const lines = (d?.TrackingCategories || []).map((c) =>
        `- **${c.Name}** (\`${c.TrackingCategoryID}\`, ${c.Status}): ${(c.Options || []).map((o) => o.Name).join(', ') || 'no options'}`);
      return { text: `### Tracking categories (${lines.length})\n\n${lines.join('\n') || 'None defined.'}`, data: d };
    });

  // ───────────────────────── contacts ─────────────────────────

  tool('xero_list_contacts', 'List contacts',
    'Customers & suppliers. Use search to find a contact and get its ContactID.',
    {
      search: z.string().optional().describe('Search name/email (Xero SearchTerm)'),
      page: z.number().int().min(1).default(1).describe('Page (100 per page)'),
      include_archived: z.boolean().default(false).describe('Include archived contacts')
    }, RO,
    async ({ search, page, include_archived }) => {
      const q = [`page=${page}`, search ? `SearchTerm=${encodeURIComponent(search)}` : '', include_archived ? 'includeArchived=true' : ''].filter(Boolean).join('&');
      const d = await api(`/Contacts?${q}`);
      const lines = (d?.Contacts || []).map((c) =>
        `- **${c.Name}** (\`${c.ContactID}\`) — ${c.EmailAddress || 'no email'} | ${c.IsCustomer ? 'customer' : ''}${c.IsCustomer && c.IsSupplier ? ' + ' : ''}${c.IsSupplier ? 'supplier' : ''} | ${c.ContactStatus}`);
      return { text: `### Contacts — page ${page} (${lines.length})${search ? ` matching "${search}"` : ''}\n\n${lines.join('\n') || 'None found.'}`, data: { count: lines.length, contacts: d?.Contacts || [] } };
    });

  tool('xero_get_contact', 'Get contact',
    'Full contact record incl. outstanding receivable/payable balances.',
    { contact_id: z.string().describe('ContactID from xero_list_contacts') }, RO,
    async ({ contact_id }) => {
      const d = await api(`/Contacts/${encodeURIComponent(contact_id)}`);
      const c = d?.Contacts?.[0];
      if (!c) return { text: `Contact ${contact_id} not found.` };
      const b = c.Balances || {};
      const text = `### ${c.Name}\n\n| Field | Value |\n|---|---|\n| ContactID | \`${c.ContactID}\` |\n| Email | ${c.EmailAddress || '—'} |\n| Phones | ${(c.Phones || []).filter((p) => p.PhoneNumber).map((p) => `${p.PhoneType}: ${p.PhoneNumber}`).join(', ') || '—'} |\n| Status | ${c.ContactStatus} |\n| Owed to you (AR) | ${money(b.AccountsReceivable?.Outstanding)} (overdue ${money(b.AccountsReceivable?.Overdue)}) |\n| You owe (AP) | ${money(b.AccountsPayable?.Outstanding)} (overdue ${money(b.AccountsPayable?.Overdue)}) |`;
      return { text, data: c };
    });

  tool('xero_create_contact', 'Create contact',
    'Create a customer/supplier contact.',
    {
      name: z.string().describe('Contact name (must be unique in Xero)'),
      email: z.string().optional().describe('Email address'),
      phone: z.string().optional().describe('Phone number'),
      first_name: z.string().optional(), last_name: z.string().optional()
    }, WR,
    async ({ name, email, phone, first_name, last_name }) => {
      const body = { Contacts: [{ Name: name, ...(email ? { EmailAddress: email } : {}), ...(first_name ? { FirstName: first_name } : {}), ...(last_name ? { LastName: last_name } : {}), ...(phone ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] } : {}) }] };
      const d = await api('/Contacts', { method: 'POST', body });
      const c = d?.Contacts?.[0];
      return { text: `✅ Contact created: **${c?.Name}** (\`${c?.ContactID}\`)`, data: c };
    });

  tool('xero_update_contact', 'Update contact',
    'Update a contact\'s name/email/phone.',
    {
      contact_id: z.string().describe('ContactID'),
      name: z.string().optional(), email: z.string().optional(), phone: z.string().optional()
    }, WR,
    async ({ contact_id, name, email, phone }) => {
      const body = { Contacts: [{ ContactID: contact_id, ...(name ? { Name: name } : {}), ...(email ? { EmailAddress: email } : {}), ...(phone ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] } : {}) }] };
      const d = await api('/Contacts', { method: 'POST', body });
      const c = d?.Contacts?.[0];
      return { text: `✅ Contact updated: **${c?.Name}** (\`${c?.ContactID}\`)`, data: c };
    });

  // ───────────────────────── invoices, quotes, credit notes ─────────────────────────

  tool('xero_list_invoices', 'List invoices',
    `Sales (ACCREC) and purchase (ACCPAY) invoices with filters.

Args: status (DRAFT|SUBMITTED|AUTHORISED|PAID|VOIDED, comma-separable), contact_id, date_from/date_to (YYYY-MM-DD), invoice_number, page (100/page).`,
    {
      status: z.string().optional().describe('e.g. AUTHORISED or DRAFT,SUBMITTED'),
      contact_id: z.string().optional(),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      invoice_number: z.string().optional(),
      page: z.number().int().min(1).default(1)
    }, RO,
    async ({ status, contact_id, date_from, date_to, invoice_number, page }) => {
      const where = [];
      if (date_from) where.push(`Date >= DateTime(${date_from.replaceAll('-', ',')})`);
      if (date_to) where.push(`Date <= DateTime(${date_to.replaceAll('-', ',')})`);
      const q = [
        `page=${page}`,
        status ? `Statuses=${encodeURIComponent(status)}` : '',
        contact_id ? `ContactIDs=${encodeURIComponent(contact_id)}` : '',
        invoice_number ? `InvoiceNumbers=${encodeURIComponent(invoice_number)}` : '',
        where.length ? `where=${encodeURIComponent(where.join(' AND '))}` : ''
      ].filter(Boolean).join('&');
      const d = await api(`/Invoices?${q}`);
      const lines = (d?.Invoices || []).map((i) =>
        `- **${i.InvoiceNumber || i.InvoiceID}** ${i.Type} — ${i.Contact?.Name || '?'} | date ${xDate(i.DateString || i.Date)} due ${xDate(i.DueDateString || i.DueDate)} | total ${money(i.Total)} (due ${money(i.AmountDue)}) | ${i.Status} | \`${i.InvoiceID}\``);
      return { text: `### Invoices — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None found.'}`, data: { count: lines.length, invoices: d?.Invoices || [] } };
    });

  tool('xero_get_invoice', 'Get invoice',
    'One invoice with its line items.',
    { invoice_id: z.string().describe('InvoiceID or invoice number') }, RO,
    async ({ invoice_id }) => {
      const d = await api(`/Invoices/${encodeURIComponent(invoice_id)}`);
      const i = d?.Invoices?.[0];
      if (!i) return { text: `Invoice ${invoice_id} not found.` };
      let text = `### Invoice ${i.InvoiceNumber || i.InvoiceID} (${i.Type}, ${i.Status})\n\n**${i.Contact?.Name}** — date ${xDate(i.DateString || i.Date)}, due ${xDate(i.DueDateString || i.DueDate)}\n\n| Description | Qty | Unit | Tax | Line total |\n|---|---|---|---|---|\n`;
      for (const li of i.LineItems || []) text += `| ${li.Description || '—'} | ${li.Quantity ?? '—'} | ${money(li.UnitAmount)} | ${li.TaxType || '—'} | ${money(li.LineAmount)} |\n`;
      text += `\nSubtotal ${money(i.SubTotal)} + tax ${money(i.TotalTax)} = **${money(i.Total)}** (paid ${money(i.AmountPaid)}, due ${money(i.AmountDue)})`;
      return { text, data: i };
    });

  tool('xero_create_invoice', 'Create invoice',
    `Create a sales (ACCREC) or purchase (ACCPAY) invoice. Defaults to DRAFT — pass status AUTHORISED only when the user explicitly wants it approved.`,
    {
      type: z.enum(['ACCREC', 'ACCPAY']).default('ACCREC').describe('ACCREC = sales invoice to a customer; ACCPAY = bill from a supplier'),
      contact_id: z.string().describe('ContactID'),
      line_items: lineItemSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Invoice date (default today)'),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      reference: z.string().optional(),
      status: z.enum(['DRAFT', 'SUBMITTED', 'AUTHORISED']).default('DRAFT')
    }, WR,
    async ({ type, contact_id, line_items, date, due_date, reference, status }) => {
      const body = { Invoices: [{ Type: type, Contact: { ContactID: contact_id }, LineItems: toLines(line_items), Status: status, ...(date ? { Date: date } : {}), ...(due_date ? { DueDate: due_date } : {}), ...(reference ? { Reference: reference } : {}) }] };
      const d = await api('/Invoices', { method: 'POST', body });
      const i = d?.Invoices?.[0];
      return { text: `✅ Invoice **${i?.InvoiceNumber || i?.InvoiceID}** created (${i?.Status}) — total ${money(i?.Total)}, due ${xDate(i?.DueDateString || i?.DueDate)}\nInvoiceID: \`${i?.InvoiceID}\``, data: i };
    });

  tool('xero_update_invoice', 'Update invoice',
    'Change an invoice\'s status (AUTHORISED to approve, VOIDED to void a non-paid one), due date or reference. Voiding is irreversible.',
    {
      invoice_id: z.string(),
      status: z.enum(['SUBMITTED', 'AUTHORISED', 'VOIDED', 'DELETED']).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      reference: z.string().optional()
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ invoice_id, status, due_date, reference }) => {
      const body = { Invoices: [{ InvoiceID: invoice_id, ...(status ? { Status: status } : {}), ...(due_date ? { DueDate: due_date } : {}), ...(reference ? { Reference: reference } : {}) }] };
      const d = await api('/Invoices', { method: 'POST', body });
      const i = d?.Invoices?.[0];
      return { text: `✅ Invoice **${i?.InvoiceNumber || invoice_id}** updated — status ${i?.Status}, due ${xDate(i?.DueDateString || i?.DueDate)}`, data: i };
    });

  tool('xero_list_quotes', 'List quotes',
    'Quotes with optional status filter (DRAFT|SENT|ACCEPTED|DECLINED|INVOICED).',
    { status: z.string().optional(), page: z.number().int().min(1).default(1) }, RO,
    async ({ status, page }) => {
      const q = [`page=${page}`, status ? `Status=${encodeURIComponent(status)}` : ''].filter(Boolean).join('&');
      const d = await api(`/Quotes?${q}`);
      const lines = (d?.Quotes || []).map((qt) =>
        `- **${qt.QuoteNumber}** — ${qt.Contact?.Name || '?'} | ${xDate(qt.DateString || qt.Date)} | ${money(qt.Total)} | ${qt.Status} | \`${qt.QuoteID}\``);
      return { text: `### Quotes — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None found.'}`, data: d };
    });

  tool('xero_create_quote', 'Create quote',
    'Create a quote (DRAFT).',
    {
      contact_id: z.string(),
      line_items: lineItemSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      title: z.string().optional(), summary: z.string().optional()
    }, WR,
    async ({ contact_id, line_items, date, expiry_date, title, summary }) => {
      const body = { Quotes: [{ Contact: { ContactID: contact_id }, LineItems: toLines(line_items), Date: date || new Date().toISOString().slice(0, 10), ...(expiry_date ? { ExpiryDate: expiry_date } : {}), ...(title ? { Title: title } : {}), ...(summary ? { Summary: summary } : {}) }] };
      const d = await api('/Quotes', { method: 'POST', body });
      const qt = d?.Quotes?.[0];
      return { text: `✅ Quote **${qt?.QuoteNumber || qt?.QuoteID}** created (${qt?.Status}) — ${money(qt?.Total)}`, data: qt };
    });

  tool('xero_list_credit_notes', 'List credit notes',
    'Credit notes (ACCRECCREDIT customer / ACCPAYCREDIT supplier).',
    { page: z.number().int().min(1).default(1) }, RO,
    async ({ page }) => {
      const d = await api(`/CreditNotes?page=${page}`);
      const lines = (d?.CreditNotes || []).map((c) =>
        `- **${c.CreditNoteNumber}** ${c.Type} — ${c.Contact?.Name || '?'} | ${xDate(c.DateString || c.Date)} | ${money(c.Total)} (remaining ${money(c.RemainingCredit)}) | ${c.Status} | \`${c.CreditNoteID}\``);
      return { text: `### Credit notes — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None found.'}`, data: d };
    });

  tool('xero_create_credit_note', 'Create credit note',
    'Create a credit note (DRAFT).',
    {
      type: z.enum(['ACCRECCREDIT', 'ACCPAYCREDIT']).default('ACCRECCREDIT'),
      contact_id: z.string(),
      line_items: lineItemSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    }, WR,
    async ({ type, contact_id, line_items, date }) => {
      const body = { CreditNotes: [{ Type: type, Contact: { ContactID: contact_id }, LineItems: toLines(line_items), ...(date ? { Date: date } : {}) }] };
      const d = await api('/CreditNotes', { method: 'POST', body });
      const c = d?.CreditNotes?.[0];
      return { text: `✅ Credit note **${c?.CreditNoteNumber || c?.CreditNoteID}** created (${c?.Status}) — ${money(c?.Total)}`, data: c };
    });

  // ───────────────────────── payments, bank, items ─────────────────────────

  tool('xero_list_payments', 'List payments',
    'Payments received/made, newest first.',
    { page: z.number().int().min(1).default(1) }, RO,
    async ({ page }) => {
      const d = await api(`/Payments?page=${page}&order=${encodeURIComponent('Date DESC')}`);
      const lines = (d?.Payments || []).map((p) =>
        `- ${xDate(p.Date)} — ${money(p.Amount)} on **${p.Invoice?.InvoiceNumber || p.Invoice?.Type || '?'}** (${p.Invoice?.Contact?.Name || '?'}) via ${p.Account?.Name || p.Account?.Code || '?'} | ${p.Status} | \`${p.PaymentID}\``);
      return { text: `### Payments — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None found.'}`, data: d };
    });

  tool('xero_create_payment', 'Create payment',
    'Record a payment against an invoice, into a bank account (by account code).',
    {
      invoice_id: z.string(),
      account_code: z.string().describe('Bank account code (xero_list_accounts, Type=="BANK")'),
      amount: z.number().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Default today'),
      reference: z.string().optional()
    }, WR,
    async ({ invoice_id, account_code, amount, date, reference }) => {
      const body = { Payments: [{ Invoice: { InvoiceID: invoice_id }, Account: { Code: account_code }, Amount: amount, Date: date || new Date().toISOString().slice(0, 10), ...(reference ? { Reference: reference } : {}) }] };
      const d = await api('/Payments', { method: 'PUT', body });
      const p = d?.Payments?.[0];
      return { text: `✅ Payment of ${money(p?.Amount)} recorded on invoice (\`${p?.PaymentID}\`)`, data: p };
    });

  tool('xero_list_bank_transactions', 'List bank transactions',
    'Spend/receive money transactions.',
    { page: z.number().int().min(1).default(1), type: z.enum(['SPEND', 'RECEIVE']).optional() }, RO,
    async ({ page, type }) => {
      const q = [`page=${page}`, type ? `where=${encodeURIComponent(`Type=="${type}"`)}` : ''].filter(Boolean).join('&');
      const d = await api(`/BankTransactions?${q}`);
      const lines = (d?.BankTransactions || []).map((t) =>
        `- ${xDate(t.DateString || t.Date)} — ${t.Type} ${money(t.Total)} | ${t.Contact?.Name || '?'} | ${t.BankAccount?.Name || '?'} | ${t.Status} | \`${t.BankTransactionID}\``);
      return { text: `### Bank transactions — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None found.'}`, data: d };
    });

  tool('xero_create_bank_transaction', 'Create bank transaction',
    'Record spend or receive money directly against a bank account.',
    {
      type: z.enum(['SPEND', 'RECEIVE']),
      bank_account_code: z.string().describe('Bank account code'),
      contact_id: z.string(),
      line_items: lineItemSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    }, WR,
    async ({ type, bank_account_code, contact_id, line_items, date }) => {
      const body = { BankTransactions: [{ Type: type, Contact: { ContactID: contact_id }, BankAccount: { Code: bank_account_code }, LineItems: toLines(line_items), ...(date ? { Date: date } : {}) }] };
      const d = await api('/BankTransactions', { method: 'POST', body });
      const t = d?.BankTransactions?.[0];
      return { text: `✅ ${t?.Type} transaction created — ${money(t?.Total)} (\`${t?.BankTransactionID}\`)`, data: t };
    });

  tool('xero_list_items', 'List items',
    'Products/services with sales & purchase prices.',
    {}, RO,
    async () => {
      const d = await api('/Items');
      const rows = (d?.Items || []).map((i) => `| \`${i.Code}\` | ${i.Name} | ${money(i.SalesDetails?.UnitPrice)} | ${money(i.PurchaseDetails?.UnitPrice)} | ${i.IsTrackedAsInventory ? 'yes' : 'no'} |`);
      return { text: `### Items (${rows.length})\n\n| Code | Name | Sell | Buy | Tracked |\n|---|---|---|---|---|\n${rows.join('\n') || ''}`, data: d };
    });

  tool('xero_upsert_item', 'Create/update item',
    'Create an item, or update it if the code already exists (Xero upserts by Code).',
    {
      code: z.string().describe('Unique item code'),
      name: z.string(),
      sell_price: z.number().optional(), sell_account_code: z.string().optional(),
      buy_price: z.number().optional(), buy_account_code: z.string().optional(),
      description: z.string().optional()
    }, WR,
    async ({ code, name, sell_price, sell_account_code, buy_price, buy_account_code, description }) => {
      const body = { Items: [{ Code: code, Name: name, ...(description ? { Description: description } : {}), ...(sell_price !== undefined ? { SalesDetails: { UnitPrice: sell_price, ...(sell_account_code ? { AccountCode: sell_account_code } : {}) } } : {}), ...(buy_price !== undefined ? { PurchaseDetails: { UnitPrice: buy_price, ...(buy_account_code ? { AccountCode: buy_account_code } : {}) } } : {}) }] };
      const d = await api('/Items', { method: 'POST', body });
      const i = d?.Items?.[0];
      return { text: `✅ Item **${i?.Code}** — ${i?.Name} saved (\`${i?.ItemID}\`)`, data: i };
    });

  // ───────────────────────── reports ─────────────────────────

  tool('xero_report', 'Run report',
    `Live financial reports rendered as a table.

Args:
  - report: ProfitAndLoss | BalanceSheet | TrialBalance | AgedReceivablesByContact | AgedPayablesByContact | BankSummary | ExecutiveSummary
  - from_date/to_date for P&L + BankSummary; date for BalanceSheet/TrialBalance/Aged*; contact_id REQUIRED for the two Aged* reports.`,
    {
      report: z.enum(['ProfitAndLoss', 'BalanceSheet', 'TrialBalance', 'AgedReceivablesByContact', 'AgedPayablesByContact', 'BankSummary', 'ExecutiveSummary']),
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      contact_id: z.string().optional().describe('Required for AgedReceivables/AgedPayables')
    }, RO,
    async ({ report, from_date, to_date, date, contact_id }) => {
      if (/^Aged/.test(report) && !contact_id) return { text: `Error: ${report} needs contact_id (find it with xero_list_contacts).` };
      const q = [
        from_date ? `fromDate=${from_date}` : '', to_date ? `toDate=${to_date}` : '',
        date ? `date=${date}` : '', contact_id ? `contactId=${contact_id}` : ''
      ].filter(Boolean).join('&');
      const d = await api(`/Reports/${report}${q ? `?${q}` : ''}`);
      const rep = d?.Reports?.[0];
      return { text: clip(renderReport(rep)), data: rep };
    });

  // ───────────────────────── payroll (UK/NZ orgs) ─────────────────────────

  tool('xero_list_employees', 'List employees',
    'Payroll employees (UK/NZ payroll orgs) — the employeeIDs feed the leave & timesheet tools.',
    { page: z.number().int().min(1).default(1) }, RO,
    async ({ page }) => {
      const d = await api(`/Employees?page=${page}`, { payroll: true });
      const emps = d?.employees || d?.Employees || [];
      const lines = emps.map((e) => `- **${e.firstName || e.FirstName} ${e.lastName || e.LastName}** (\`${e.employeeID || e.EmployeeID}\`)${e.jobTitle ? ` — ${e.jobTitle}` : ''}${e.startDate ? ` | started ${xDate(e.startDate)}` : ''}`);
      return { text: `### Employees — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None (does this org have a UK/NZ Payroll subscription and the payroll.employees scope?)'}`, data: { count: lines.length, employees: emps } };
    });

  tool('xero_get_employee', 'Get employee',
    'One employee\'s payroll record.',
    { employee_id: z.string().describe('employeeID from xero_list_employees') }, RO,
    async ({ employee_id }) => {
      const d = await api(`/Employees/${encodeURIComponent(employee_id)}`, { payroll: true });
      const e = d?.employee || d?.Employee || d;
      const text = `### ${e.firstName} ${e.lastName}\n\n| Field | Value |\n|---|---|\n| employeeID | \`${e.employeeID}\` |\n| Job title | ${e.jobTitle || '—'} |\n| Start date | ${xDate(e.startDate)} |\n| Email | ${e.email || '—'} |\n| Payroll calendar | \`${e.payrollCalendarID || '—'}\` |`;
      return { text, data: e };
    });

  tool('xero_employee_leave_balances', 'Employee leave balances',
    'Remaining leave (holiday) balances for an employee — name, hours/days remaining, per leave type. THE tool for "how much holiday does X have left?"',
    { employee_id: z.string().describe('employeeID from xero_list_employees') }, RO,
    async ({ employee_id }) => {
      const d = await api(`/Employees/${encodeURIComponent(employee_id)}/LeaveBalances`, { payroll: true });
      const bals = d?.leaveBalances || d?.LeaveBalances || [];
      const rows = bals.map((b) => `| ${b.name || b.leaveName || b.leaveType || '—'} | **${b.balance ?? '—'}** | ${b.typeOfUnits || b.typeOfUnit || 'units'} | \`${b.leaveTypeID || '—'}\` |`);
      return {
        text: `### Leave balances for employee \`${employee_id}\`\n\n| Leave type | Balance | Units | leaveTypeID |\n|---|---|---|---|\n${rows.join('\n') || '| none returned | | | |'}`,
        data: { employeeID: employee_id, leaveBalances: bals }
      };
    });

  tool('xero_list_employee_leave', 'List employee leave',
    'Leave records (booked/taken) for an employee.',
    { employee_id: z.string() }, RO,
    async ({ employee_id }) => {
      const d = await api(`/Employees/${encodeURIComponent(employee_id)}/Leave`, { payroll: true });
      const recs = d?.leave || d?.Leave || [];
      const lines = recs.map((l) => `- **${l.description || l.leaveTypeID}** — ${(l.periods || []).map((p) => `${xDate(p.startDate)} → ${xDate(p.endDate)} (${p.numberOfUnits ?? '?'} units)`).join('; ') || `${xDate(l.startDate)} → ${xDate(l.endDate)}`} | \`${l.leaveID || '—'}\``);
      return { text: `### Leave for employee \`${employee_id}\` (${lines.length})\n\n${lines.join('\n') || 'No leave records.'}`, data: d };
    });

  tool('xero_create_employee_leave', 'Book employee leave',
    'Book leave (e.g. holiday) for an employee. Confirm dates and leave type with the user first — this hits payroll.',
    {
      employee_id: z.string(),
      leave_type_id: z.string().describe('leaveTypeID from xero_employee_leave_balances or xero_list_leave_types'),
      description: z.string().describe('e.g. "Summer holiday"'),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }, WR,
    async ({ employee_id, leave_type_id, description, start_date, end_date }) => {
      const body = { leaveTypeID: leave_type_id, description, startDate: start_date, endDate: end_date };
      const d = await api(`/Employees/${encodeURIComponent(employee_id)}/Leave`, { method: 'POST', body, payroll: true });
      const l = d?.leave || d;
      return { text: `✅ Leave booked: **${description}** ${start_date} → ${end_date} (leaveID \`${l?.leaveID || '—'}\`)`, data: l };
    });

  tool('xero_list_leave_types', 'List leave types',
    'Org-wide leave types (holiday, sick, …) with their leaveTypeIDs.',
    {}, RO,
    async () => {
      const d = await api('/LeaveTypes', { payroll: true });
      const types = d?.leaveTypes || d?.LeaveTypes || [];
      const lines = types.map((t) => `- **${t.name}** (\`${t.leaveTypeID}\`) — ${t.typeOfUnits || ''}${t.isPaidLeave === false ? ', unpaid' : ''}`);
      return { text: `### Leave types (${lines.length})\n\n${lines.join('\n') || 'None returned.'}`, data: d };
    });

  tool('xero_list_timesheets', 'List timesheets',
    'Payroll timesheets, optionally for one employee.',
    { employee_id: z.string().optional(), page: z.number().int().min(1).default(1) }, RO,
    async ({ employee_id, page }) => {
      const q = [`page=${page}`, employee_id ? `filter=employeeId==${encodeURIComponent(employee_id)}` : ''].filter(Boolean).join('&');
      const d = await api(`/Timesheets?${q}`, { payroll: true });
      const ts = d?.timesheets || d?.Timesheets || [];
      const lines = ts.map((t) => `- \`${t.timesheetID}\` — employee \`${t.employeeID}\` | ${xDate(t.startDate)} → ${xDate(t.endDate)} | ${t.totalHours ?? '?'}h | ${t.status}`);
      return { text: `### Timesheets — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None found.'}`, data: d };
    });

  tool('xero_list_pay_runs', 'List pay runs',
    'Payroll pay runs with period, payment date and status.',
    { page: z.number().int().min(1).default(1) }, RO,
    async ({ page }) => {
      const d = await api(`/PayRuns?page=${page}`, { payroll: true });
      const runs = d?.payRuns || d?.PayRuns || [];
      const lines = runs.map((r) => `- \`${r.payRunID}\` — ${xDate(r.periodStartDate)} → ${xDate(r.periodEndDate)} | pay date ${xDate(r.paymentDate)} | ${r.payRunStatus || r.status}`);
      return { text: `### Pay runs — page ${page} (${lines.length})\n\n${lines.join('\n') || 'None found.'}`, data: d };
    });

  log('xero module registered (31 tools)');
}

// Powers the ▶ Test button — full auth round trip + org fetch
export async function test(settings, { fetchJson }) {
  if (!settings.client_id || !settings.client_secret) {
    return { ok: false, message: 'client_id / client_secret missing — create a Custom Connection at developer.xero.com and paste both.' };
  }
  try {
    const basic = btoa(`${settings.client_id}:${settings.client_secret}`);
    const scope = settings.scopes || 'accounting.settings';
    const tok = await fetchJson(`${IDENTITY_BASE}/connect/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`
    });
    const conns = await fetchJson(`${API_BASE}/connections`, { headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Accept': 'application/json' } });
    const tenant = settings.tenant_id || (Array.isArray(conns) && conns[0]?.tenantId);
    if (!tenant) return { ok: false, message: 'Token OK but no tenant found — authorise the Custom Connection against your organisation.' };
    const org = await fetchJson(`${API_BASE}/api.xro/2.0/Organisation`, { headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Xero-Tenant-Id': tenant, 'Accept': 'application/json' } });
    const name = org?.Organisations?.[0]?.Name || 'unknown org';
    return { ok: true, message: `Connected to ${name} (tenant ${String(tenant).slice(0, 8)}…)` };
  } catch (e) {
    return { ok: false, message: `Connection failed: ${e.message}` };
  }
}
