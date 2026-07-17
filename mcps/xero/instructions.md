# Xero — how to work with this connector

This is live company accounting and payroll data. Follow these rules on every call.

**Money-touching actions are two-step.** Create invoices, quotes, credit notes, payments and bank transactions as **DRAFT** (the default) unless the user explicitly says to approve/authorise. Never set `AUTHORISED`, void an invoice, or record a payment without the user having confirmed the exact amounts, contact and dates in this conversation. Voiding is irreversible.

**Look up IDs, never guess them.** ContactIDs come from `xero_list_contacts`, account codes from `xero_list_accounts`, TaxTypes from `xero_list_tax_rates`, employeeIDs from `xero_list_employees`, leaveTypeIDs from `xero_employee_leave_balances` or `xero_list_leave_types`.

**Common flows.**
- "How much holiday does X have left?" → `xero_list_employees` (find X) → `xero_employee_leave_balances`.
- "Book X a week off" → find employee → check balances/leave types → **confirm dates + type with the user** → `xero_create_employee_leave`.
- "Invoice Y for £Z" → `xero_list_contacts` (find Y) → `xero_create_invoice` (DRAFT) → show it → only authorise on explicit confirmation.
- "Who owes us money?" → `xero_report` AgedReceivablesByContact per contact, or `xero_list_invoices` with status `AUTHORISED`.

**Payroll tools require a UK/NZ Xero Payroll subscription** and the `payroll.*` scopes on the Custom Connection; a 403 on those tools means scope or subscription, not a bug.

Amounts are in the organisation's base currency (see `xero_get_organisation`) unless stated otherwise. Don't paste full personal employee records into chat beyond what the user asked for.
