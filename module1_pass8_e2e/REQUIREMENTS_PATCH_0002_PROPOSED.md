# Requirements Patch 0002 — Audit Export Ownership

Status: **APPROVED additive contract patch — approved during Audit Pass 1 contract resolution**

This approved patch resolves one ambiguity between Module 21 Documents & Audit Log and Module 20 Reports & Analytics. It does not change the selected technology stack, repository topology, seller isolation rules, state-machine ownership, or generation order.

## Why this patch exists

The base Module 21 contract requires an audit export capability through:

```text
audit.export
audit.export_requested
Audit detail/export
```

But the literal Module 21 HTTP route table contains only audit search/detail reads and does not define an audit-export command.

The base Module 20 contract already owns asynchronous export execution through:

```text
POST /api/v1/reports/runs
GET  /api/v1/reports/runs/:id
```

Module 20 also owns report definitions/runs, export workers, generated files, export-ready notifications, and the `reports.export` permission.

## Approved ownership rule

1. **Module 21 remains the authoritative audit data/read surface.**
   - Keep `GET /api/v1/audit`.
   - Keep `GET /api/v1/audit/:id`.
   - Do not invent `/api/v1/audit/export` or another Module 21 export route.

2. **Module 20 owns audit export execution.**
   - Add an allow-listed audit-log report definition when Module 20 is generated.
   - Start the export through `POST /api/v1/reports/runs`.
   - Read status/download through `GET /api/v1/reports/runs/:id`.
   - Generated files remain stored through Module 21 Documents/Storage.

3. **Audit export authorization remains domain-aware.**
   - The audit export report requires `audit.read` and `audit.export` for audit scope.
   - It also follows Module 20's report-export authorization rules.
   - Seller/resource scope is derived server-side; a caller cannot request a broader audit scope than allowed.

4. **Event ownership is explicit.**
   - Module 20 emits its normal `report.run_requested` event for the export run.
   - For an audit-log export run, it also emits `audit.export_requested` so the Module 21 event requirement remains represented without creating a second export engine.

5. **Frontend ownership stays simple.**
   - Before Module 20 exists, Module 21 keeps Audit search/detail only and ships no dead Export button.
   - After Module 20 is generated, the Audit UI may expose its required Export action by calling the Module 20 report-run API.
   - No direct database access or duplicate export worker is added to Module 21.

## Why this is preferred

This patch uses the export infrastructure already required by Module 20 and avoids:

- an undocumented Module 21 route;
- duplicate export jobs/workers;
- duplicate file-generation logic;
- an unused permission/event placeholder before an executable workflow exists;
- business logic in controllers or cross-module repository access.

## What does not change

- Module 21 file upload/link/download behavior.
- Append-only audit storage/read behavior.
- Module 20 report-run tables/routes.
- Foundation outbox/job ownership.
- Existing approved Patch 0001 routes.
- Any currently implemented database migration or API route.

## Approval record

Approved in Audit Remediation Pass 1. This patch is now controlling for audit-export ownership.

Runtime impact at this pass: **none**. Module 21 keeps search/detail only until Module 20 exists; Module 20 will own the executable audit-export run when it is generated.
