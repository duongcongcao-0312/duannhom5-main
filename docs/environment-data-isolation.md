# Environment and data isolation

BookNest uses separate application settings, database instances, database users,
and credentials for development, staging, and production. Configure `APP_ENV`
explicitly in every deployed service. `NODE_ENV` controls Node.js runtime behavior;
staging and production both use `NODE_ENV=production`, while `APP_ENV` keeps their
data and secrets isolated.

| Environment | `APP_ENV` | `NODE_ENV` | Database and role | Allowed data |
| --- | --- | --- | --- | --- |
| Development | `development` | `development` | Local file store or dedicated `booknest_dev` database and role | Synthetic fixtures and seed data |
| CI/test | `test` | `test` | Disposable `booknest_test` database and role | Synthetic fixtures only |
| Staging | `staging` | `production` | Separate `booknest_staging` instance and least-privilege staging role | Synthetic or irreversibly anonymized data |
| Production | `production` | `production` | Production-only managed database and least-privilege production role | Live customer data; never seed |

## Automated safeguards

`backend/env-isolation.js` is called before the server starts, before migrations,
and by the pre-deploy check. It rejects production database markers in development,
test, and staging; rejects local, development, test, and staging targets in
production; checks `EXPECTED_DATABASE_NAME` when supplied; and requires that
variable for staging and production database connections. Staging must use
`NODE_ENV=production` so it receives production runtime security safeguards.
Diagnostics contain target names only and never print connection credentials.

Set `EXPECTED_DATABASE_NAME` to the exact database name for each staging or
production service. The Render production blueprint declares it as a non-synced
variable alongside `DATABASE_URL`; enter both through that service's secret and
environment settings. The checked-in Render blueprint sets `APP_ENV=production`.
`render.staging.yaml` is a separate, non-auto-deploying staging blueprint with
`APP_ENV=staging` and the pinned `booknest_staging` database name. Provision its
own PostgreSQL instance, then attach only that instance's connection URL and
staging-only credentials to the staging service. Do not deploy both blueprints
against the same database or copy the production service's environment values.
The local Compose stack sets `APP_ENV=development` and uses its own local-only
database credentials. CI sets `APP_ENV=test` and provisions a disposable database.

Application-side checks are a safety net, not a substitute for provider-level
isolation. Create separate database instances and separate database users with
least privilege. Do not reuse `DATABASE_URL`, admin credentials, webhook secrets,
payment credentials, or encryption keys between environments. Give each environment
its own secret store/access policy and restrict production access to operators who
need it. Never place secrets in Git, image build arguments, frontend variables, or
build artifacts.

## Promotion and configuration changes

1. Develop against local services and synthetic data. Run checks in CI using its
   disposable database; CI credentials must not grant access to shared databases.
2. Promote a reviewed commit to staging using `render.staging.yaml`. Configure
   staging's own `APP_ENV=staging`,
   `NODE_ENV=production`, `DATABASE_URL`, and matching `EXPECTED_DATABASE_NAME` in
   the staging provider service. Use separate test payment/email credentials and
   staging-only callback URLs. Do not copy production records into staging; if a
   staging scenario needs realistic data, anonymize it before import.
3. Validate migrations and application behavior in staging, review the deployment
   and health/readiness results, and record the tested commit and configuration
   changes without recording secret values.
4. Promote the same reviewed commit to production through the hosting provider's
   production service. The Render blueprint disables automatic deploys, so an
   operator must trigger production deployment after reviewing staging evidence.
   Keep production environment access restricted and require the provider's
   configured review/approval gate before production deployment.
   Re-enter production-only credentials from the production secret store; do not
   copy staging variables or database contents.
5. Before a schema change, take and verify a production backup. Run the configured
   pre-deploy checks and migration only against the explicitly selected target.
   After deployment, verify `/health`, `/ready`, and the smoke check. Roll back the
   application only when the migration remains compatible; otherwise use the
   documented forward-fix or restore runbook.

Changes to environment variables must be reviewed alongside code changes. Record
the environment, variable names changed, reason, approver, and deployment ID in the
change record; never record values. Provider environment approvals, branch rules,
separate staging infrastructure, and production deployment evidence are provider
operations and must be configured and verified there. The repository cannot prove
that a provider account has those controls enabled.

## Verify a target before deployment

Run `npm run predeploy:check` in the target environment. For staging or production,
provide `APP_ENV`, `NODE_ENV=production`, `DATABASE_URL`, and the exact
`EXPECTED_DATABASE_NAME`. A mismatch or missing database-name pin fails closed.
The `startCommand` in `render.yaml` runs this check before migrations and server
startup. `npm run seed:customers` is restricted to non-production and separately
checks that its database target is not production.

See [deployment.md](./deployment.md) and the
[production readiness checklist](./production-readiness-checklist.md) for the
deployment and operational checks.
