# Production configuration release gate

`npm run predeploy:check` is the release gate for production configuration. It is
run by CI and by the Render start command before migrations or the web server
start. A failure exits non-zero and blocks release/startup. The report contains
status and counts only; it never prints environment values or credentials.

The gate checks:

- Required production credentials, PostgreSQL target pinning, payment settings,
  proxy trust settings, HTTPS-only CORS, migration ordering, and environment
  isolation.
- Public application/API URLs use HTTPS and do not point at local or staging
  hosts. Production cannot opt in to a local database.
- Node inspector and `DEBUG` are disabled for production.
- `package-lock.json` is valid and its root dependencies match `package.json`.
- The production Docker image installs locked production dependencies and runs
  as a non-root user.

Database connections use TLS in staging and production. `DATABASE_SSL_CA_PATH`
can supply a private CA; connection URL SSL query parameters cannot downgrade
the runtime TLS policy. Keep database credentials scoped to the application's
required schema and operations, and keep Render secrets in that service's
Environment settings.

Some production controls belong to the hosting provider and cannot be proven by
a repository check. Before release, confirm the Render service uses the
production database and expected database name, TLS is enabled at the public
edge, deploy access is limited to the release workflow, and runtime logs do not
contain credentials. Use separate staging and production services, databases,
and secrets. Review service and database roles in the provider console because
the application cannot establish the privileges attached to a database user
from its URL alone.

Run locally with `npm run predeploy:check`. To inspect configuration without
printing values, use `npm run config:check`.
