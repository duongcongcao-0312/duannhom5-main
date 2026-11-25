# Accessibility contrast audit

## Method and scope

`node --test tests/accessibility.test.js` reads the semantic color values in
`main.css` and `admin.css` and measures their WCAG contrast ratios. Normal text
uses the 4.5:1 threshold, large text uses 3:1, and focus/control boundaries use
3:1. The test verifies token values and token-pair ratios; it does not render
browser-computed styles or claim a full page accessibility audit.

## Measured semantic combinations

| Theme | Foreground / role | Surface | Ratio | Threshold |
| --- | --- | --- | ---: | ---: |
| Storefront | `--color-text` normal text | `--color-background` | 12.32:1 | 4.5:1 |
| Storefront | `--color-text` large text | `--color-background` | 12.32:1 | 3:1 |
| Storefront | `--color-text-muted` muted text | `--color-surface` | 5.66:1 | 4.5:1 |
| Storefront | `--color-text-placeholder` placeholder | `--color-surface` | 5.66:1 | 4.5:1 |
| Storefront | `--color-on-primary` button label | `--color-primary` | 8.16:1 | 4.5:1 |
| Storefront | `--color-success` success | `--color-success-surface` | 6.85:1 | 4.5:1 |
| Storefront | `--color-warning` warning | `--color-warning-surface` | 5.83:1 | 4.5:1 |
| Storefront | `--color-info` information | `--color-info-surface` | 10.96:1 | 4.5:1 |
| Storefront | `--color-shipping` shipping | `--color-shipping-surface` | 7.39:1 | 4.5:1 |
| Storefront | `--color-danger` error | `--color-danger-surface` | 4.57:1 | 4.5:1 |
| Storefront | `--color-disabled-text` disabled label | `--color-surface` | 5.66:1 | 4.5:1 |
| Storefront | `--color-focus` focus indicator | `--color-background` | 4.52:1 | 3:1 |
| Storefront | `--color-control-border` control boundary | `--color-surface` | 4.60:1 | 3:1 |
| Admin | `--color-text` normal text | `--color-background` | 13.76:1 | 4.5:1 |
| Admin | `--color-text` large text | `--color-background` | 13.76:1 | 3:1 |
| Admin | `--color-text-muted` muted text | `--color-surface` | 4.83:1 | 4.5:1 |
| Admin | `--color-text-placeholder` placeholder | `--color-surface` | 4.83:1 | 4.5:1 |
| Admin | `--color-on-primary` button label | `--color-primary` | 8.62:1 | 4.5:1 |
| Admin | `--color-success` success | `--color-success-surface` | 6.78:1 | 4.5:1 |
| Admin | `--color-warning` warning | `--color-warning-surface` | 6.37:1 | 4.5:1 |
| Admin | `--color-info` information | `--color-info-surface` | 7.15:1 | 4.5:1 |
| Admin | `--color-shipping` shipping | `--color-shipping-surface` | 7.39:1 | 4.5:1 |
| Admin | `--color-danger` error | `--color-danger-surface` | 6.80:1 | 4.5:1 |
| Admin | `--color-disabled-text` disabled label | `--color-surface` | 4.83:1 | 4.5:1 |
| Admin | `--color-focus` focus indicator | `--color-background` | 8.08:1 | 3:1 |
| Admin | `--color-control-border` control boundary | `--color-surface` | 4.83:1 | 3:1 |

## Browser and device coverage

The repository's automated matrix is Chromium desktop (Chrome), Chromium
desktop (Edge), and WebKit using the Playwright iPhone 13 profile, as described
in [`browser-compatibility.md`](./browser-compatibility.md). These projects
were not run as part of this token audit; the results above are from the
focused Node test only. Emulated viewport coverage is not physical-device
coverage.

## Admin keyboard and responsive checks

The focused admin Playwright checks passed in Chrome and Edge for keyboard
focus on the skip link, moving focus to main content, and selecting a view
with the keyboard. Navigation and table scrolling passed in Chrome, Edge, and
the iPhone 13 WebKit profile at 390×844 (portrait) and 844×390 (landscape),
without page-level horizontal overflow. The keyboard test was skipped in the
iPhone profile because the emulation does not provide hardware-keyboard Tab
traversal. This is emulated browser coverage, not physical-device testing.

## Limitations

Contrast pairs use the declared semantic colors and do not account for
transparency, opacity, images, gradients, or dynamically composed browser
styles. Interactive states and rendered pages still require the browser
checks in the applicable issue plans.
