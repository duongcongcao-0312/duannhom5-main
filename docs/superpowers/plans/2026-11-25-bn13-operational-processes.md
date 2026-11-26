# BN-13 Operational Processes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver six role-owned Vietnamese operating procedures that satisfy issues #180–#185 without conflicting with current public policies or implemented permissions.

**Architecture:** Add one issue-specific procedure per workflow, extend the existing refund procedure, and link the six documents from the README reference list. Reuse existing roles, order/payment states, and customer-facing policy commitments; flag business-specific details that remain unassigned.

**Tech Stack:** Markdown documentation; existing repository policies and code as factual references.

**Spec:** `docs/superpowers/specs/2026-11-25-bn13-operational-processes-design.md`

## Global Constraints

- Write in Vietnamese to match the issue and repository operating documents.
- Define responsibilities by existing staff role and operational function, not personal names.
- Do not invent contact channels, staff identities, business hours, thresholds, or legal approvals.
- Link customer-facing commitments to the existing public policies and distinguish those from internal target response times.
- Do not change application behavior, APIs, public policy pages, or database schemas.

## Review Focus

- Product/media publication: license evidence and `admin`-only catalog writes must not be bypassed.
- Order workflow: only use existing order states; sales cannot set payment status.
- Support/complaint records: avoid collecting or logging unnecessary sensitive customer data.
- Refund operations: keep reconciliation, approval, execution, and recorded payment status aligned with the existing refund policy.
- Inventory adjustments: reconcile order reservations and never reduce available stock below active reservations.

---

### Task 1: Document Product Management (#180)

**Files:**
- Create: `docs/product-management-procedure.md`

**Interfaces:**
- Consumes: `docs/content-rights-review.md`, `docs/authorization.md`, `backend/authorization.js`.
- Produces: the product lifecycle SOP linked from the README.

- [ ] Create the procedure covering accountable roles, required product fields/images/pricing/status, pre-publication content and rights review, authorized updates/audit trail, out-of-stock handling, and retirement.
- [ ] Verify every workflow step respects admin-only catalog writes and links to the content-rights procedure; flag missing evidence/owner assignments as pre-publication blockers.
- [ ] Commit this issue-specific document.

### Task 2: Document Order Fulfillment (#181)

**Files:**
- Create: `docs/order-fulfillment-procedure.md`

**Interfaces:**
- Consumes: `backend/business-constants.js`, `docs/authorization.md`, `docs/shipping-policy-procedure.md`, `docs/refund-policy-procedure.md`.
- Produces: the order intake-to-close workflow linked from the README.

- [ ] Create the procedure covering intake and payment verification, preparation, shipping handoff/tracking, role handoffs, customer updates, exceptional data, cancellation, and system failures.
- [ ] Verify the documented lifecycle only uses `received`, `processing`, `shipping`, `completed`, and `cancelled`; distinguish payment state from order state and respect sales/admin permissions.
- [ ] Commit this issue-specific document.

### Task 3: Document Customer Support (#182)

**Files:**
- Create: `docs/customer-support-procedure.md`

**Interfaces:**
- Consumes: `docs/customer-crm.md`, `docs/authorization.md`, `docs/privacy-request-procedure.md`.
- Produces: a support workflow with channel-readiness and coverage details linked from the README.

- [ ] Create the procedure covering official-channel readiness, duty ownership, hours/response targets, order lookup, FAQs, CRM interaction notes, escalation, and privacy-safe handling.
- [ ] Verify no real contact, staffing, or schedule is fabricated; clearly mark operator assignments and publication of official channels/hours as required before launch.
- [ ] Commit this issue-specific document.

### Task 4: Document Complaint Handling (#183)

**Files:**
- Create: `docs/complaint-handling-procedure.md`

**Interfaces:**
- Consumes: `docs/return-policy-procedure.md`, `docs/refund-policy-procedure.md`, `docs/customer-support-procedure.md`, `docs/customer-crm.md`.
- Produces: complaint intake, tracking, escalation, resolution, and learning workflow linked from the README.

- [ ] Create the procedure covering acknowledgement, severity classification, evidence, an assigned owner/status, resolution communication, escalation, and improvement feedback.
- [ ] Verify complaint timelines and customer commitments do not contradict published return, shipping, or refund policies; avoid storing sensitive evidence in general CRM notes.
- [ ] Commit this issue-specific document.

### Task 5: Complete Refund Operations (#184)

**Files:**
- Modify: `docs/refund-policy-procedure.md`

**Interfaces:**
- Consumes: existing refund eligibility, payment-provider reconciliation, role permissions, and audit behavior documented in `docs/refund-policy-procedure.md` and `docs/authorization.md`.
- Produces: a complete refund SOP for approval authority, partial/duplicate requests, failures, evidence, and customer status updates.

- [ ] Extend the current procedure with explicit approval/authority, partial refund handling, duplicate-request prevention, failed transfers, reconciliation evidence, and customer notification/status tracking.
- [ ] Verify no existing eligibility or timing commitment is silently changed; state that actual approval assignments must be confirmed by the operator.
- [ ] Commit the refund procedure update.

### Task 6: Document Inventory Management (#185)

**Files:**
- Create: `docs/inventory-management-procedure.md`

**Interfaces:**
- Consumes: inventory and order-reservation behavior in `backend/app.js`, `docs/authorization.md`, and the order fulfillment procedure.
- Produces: a stock receipt-to-reconciliation SOP linked from the README.

- [ ] Create the procedure covering receiving, adjustment authority/reasons, reservation and release, returns, low-stock alerting, cycle counts, discrepancy response, and reconciliation ownership.
- [ ] Verify the procedure does not advise selling reserved stock, bypassing existing stock checks, or using unlogged manual overrides; mark alert thresholds as operator-configured.
- [ ] Commit this issue-specific document.

### Task 7: Add Documentation Navigation and Verify

**Files:**
- Modify: `README.md` under `Tài liệu tham khảo`.

**Interfaces:**
- Consumes: the five new procedures and the updated refund procedure.
- Produces: discoverable links for all six issue deliverables.

- [ ] Add a concise BN-13 operations entry linking all six procedures.
- [ ] Verify all six local Markdown links resolve and every issue's checklist is represented; run `git diff --check`.
- [ ] Confirm the worktree contains only the intended documentation changes and push the feature branch to `origin` after the commits are complete.
