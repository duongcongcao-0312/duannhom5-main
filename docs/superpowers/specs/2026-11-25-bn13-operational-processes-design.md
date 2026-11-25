# BN-13 Operational Processes Design

## Intent

Complete the operational documentation requested by issues #180–#185 so BookNest staff can manage the product lifecycle, orders, customer support, complaints, refunds, and inventory consistently. The material is for the current demo project and must not imply that missing business contact details or pre-launch approvals already exist.

## Goals

- Provide one practical, role-owned workflow for each issue, including intake, checks, handoffs, status/records, exception handling, and escalation.
- Reuse and link to existing policies rather than redefine customer-facing terms.
- Match documented application roles, order states, authorization boundaries, CRM capabilities, and inventory behavior.
- Make unresolved launch-specific details visible instead of inventing contact channels, staff identities, business hours, or legal approvals.

## Non-goals

- Changing application behavior, APIs, public policy pages, or database schemas.
- Deciding actual staffing assignments, support opening hours, or official contact details without operator input.
- Replacing legal/accounting review or claiming that the demo is ready for commercial operation.

## Constraints and existing context

- Existing procedures cover shipping, return/complaint handling, refunds, content rights, and CRM; new procedures must defer to those where relevant.
- Staff roles include `admin`, `sales`, and `support`. Product writes are admin-only; sales can update order workflow states but not payment state; support can read/create CRM interactions but cannot modify customer records.
- Order workflow states are `received`, `processing`, `shipping`, `completed`, and `cancelled`; payment states are separate.
- Inventory is tied to orders and reservations. Procedures must not encourage overselling, untracked manual edits, or changing payment status outside the authorized refund/payment flow.
- The repository does not disclose an official customer-support email/phone, coverage hours, or named duty staff.

## Approaches

1. **Six linked issue-specific procedures (selected):** one document per issue, with a shared role vocabulary and links to existing policy/runbook documents. This maps directly to issue acceptance and keeps changes independently maintainable.
2. **One BN-13 operations handbook:** a single document covering all six areas. It reduces navigation but makes ownership and issue-level maintenance less clear and duplicates links/sections from the existing policy documents.

Six linked procedures are selected because each issue has distinct work, acceptance criteria, and owners, while refund, returns, delivery, and content rights already have authoritative related documents.

## Proposed documents

- Issue #180: product creation/review/publication, required catalog fields and licensed media, updates/audit, out-of-stock and retirement workflow.
- Issue #181: order intake, payment verification boundaries, preparation, handoff, shipment tracking, status updates, customer communication, cancellation/system exceptions.
- Issue #182: support channel readiness, duty ownership, response targets, common questions/order lookup, CRM interaction recording, privacy-safe notes, escalation.
- Issue #183: complaint intake/acknowledgement, severity and evidence, owner/status tracking, resolution communication, escalation, and improvement feedback.
- Issue #184: refund eligibility/approval authority, reconciliation/evidence, partial and duplicate requests, failures, customer updates, and links to the existing refund procedure.
- Issue #185: receiving/adjusting/reserving/releasing/returning stock, permission and reason logging, low-stock alerts, count reconciliation, discrepancy escalation.

## Decisions left to the builder

- Use the smallest documentation-only change that satisfies all six issues; write in Vietnamese to match the issue and repository operating documents.
- Define responsibilities by existing staff role and operational function, not personal names.
- Where a real contact, schedule, named duty person, threshold, or pre-launch sign-off is unavailable, state that it must be assigned/verified before go-live; do not make up values.
- Link customer-facing commitments to the existing public policies and distinguish those from internal target response times.
- Add a concise navigation entry only if an existing documentation index is found; do not create an unrelated index or application feature.

## Verification

- Cross-check each procedure against the existing policy, role matrix, order states, and inventory behavior.
- Check Markdown links and references to existing routes/files.
- Run the repository's existing tests only if a directly relevant documentation check or behavior change warrants them; the planned change is documentation-only.
