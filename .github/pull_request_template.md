## Summary

<!-- what changed and why -->

## Tenant safety

LogTide is multi-tenant. Confirm the following for any new/changed query, endpoint,
or background job (see `docs/security/tenant-isolation-audit.md`):

- [ ] Tenant tables are filtered by `organization_id` (and `project_id` where relevant).
- [ ] Joins enforce scoping at every level, not just the outer query.
- [ ] Updates/deletes verify scope before executing, not just trusting the filter to match.
- [ ] Cache keys include the organization id.
- [ ] Background jobs carry the org id and the consumer re-validates it.
- [ ] Ids from a URL parameter or request body are verified to belong to the requesting tenant before use.
- [ ] New data-access paths are added to the audit doc.
- [ ] `npm run check:tenant-scoping` passes (run from `packages/backend`).

<!-- If a change is intentionally cross-tenant (admin / platform), say so here. -->

## Contributor License Agreement

- [ ] I have signed the CLA (<https://cla-assistant.io/logtide-dev/logtide>) and my commits use an email linked to my GitHub account.

## Testing

<!-- how this was verified -->
