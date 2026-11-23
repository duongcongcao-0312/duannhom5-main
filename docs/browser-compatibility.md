# Browser compatibility and QA

BookNest runs its commerce E2E flow against this CI matrix on every push and pull request:

| Project | Engine and configuration | Coverage |
| --- | --- | --- |
| `chrome` | Chromium with the Playwright Desktop Chrome profile | Desktop storefront flow |
| `edge` | Chromium with the Playwright Desktop Edge profile (`msedge` channel) | Desktop storefront flow in Microsoft Edge |
| `mobile-safari` | WebKit with the Playwright iPhone 13 profile | Mobile viewport, touch input, and Safari engine |

The flow covers account registration and login, catalog search, adding a book to the cart, coupon application, checkout, payment callbacks, and order tracking/ownership. Playwright saves screenshots, video, and traces when a test fails. CI uploads those files and the HTML report as the `browser-e2e-reports` artifact, including when the job fails.

## Run locally

Use an isolated local PostgreSQL database whose name contains `test` or `e2e`; the E2E configuration rejects non-local or non-test databases.

```powershell
$env:E2E_DATABASE_URL = "postgresql://booknest:password@127.0.0.1:5432/booknest_test"+npm run migrate
npx playwright install chrome msedge webkit
npm run test:e2e
```

To run one project, use `npx playwright test --project=chrome`, `--project=edge`, or `--project=mobile-safari`. The CI workflow installs the same browser engines and runs all three projects against the disposable PostgreSQL service.

The Playwright version and WebKit build are pinned by `@playwright/test` in `package-lock.json`. Google Chrome and Microsoft Edge are installed from their stable channels, so CI checks the releases available when each workflow runs. This matrix is automated coverage, not a claim that every operating system and physical device has been manually tested.
