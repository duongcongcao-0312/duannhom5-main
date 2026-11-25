# Design system

The storefront and admin share semantic token names but keep separate palettes
to preserve their existing visual identities. New component styles should use
semantic tokens; legacy aliases remain available while existing styles are
migrated incrementally.

## Semantic tokens

| Role | Storefront | Admin |
| --- | --- | --- |
| Text / muted / placeholder | `--color-text`, `--color-text-muted`, `--color-text-placeholder` | Same |
| Page / raised surface | `--color-background`, `--color-surface` | Same |
| Primary / on-primary / hover / subtle | `--color-primary`, `--color-on-primary`, `--color-primary-hover`, `--color-primary-subtle` | Same |
| Accent | `--color-accent` | Same |
| Status foregrounds | `--color-success`, `--color-warning`, `--color-info`, `--color-shipping`, `--color-danger` | Same |
| Status surfaces | `--color-success-surface`, `--color-warning-surface`, `--color-info-surface`, `--color-shipping-surface`, `--color-danger-surface` | Same |
| Disabled text / focus / borders | `--color-disabled-text`, `--color-focus`, `--color-border`, `--color-control-border` | Same |

Storefront legacy aliases (`--ink`, `--muted`, `--cream`, `--paper`,
`--green`, `--green-light`, `--coral`, `--gold`, and `--line`) point to the
semantic palette. Admin aliases (`--primary`, `--primary-hover`,
`--primary-light`, `--accent`, `--bg-main`, `--bg-card`, `--text-main`,
`--text-muted`, `--border`, `--success`, `--warning`, `--info`, and `--danger`)
do the same. Keep these aliases until remaining legacy declarations are
migrated.

## Typography, spacing, and shape

Both themes define `--font-body`, `--font-display`, `--font-size-body`,
`--font-size-small`, `--font-size-large`, and `--line-height-body`. They also
share the `--space-1` through `--space-6` scale and `--radius-control` /
`--radius-card` roles. Storefront display headings use the serif display face;
admin uses its system sans-serif stack for both roles. Existing component-level
sizes remain in place to avoid broad visual changes.

## Component and state conventions

- Use the `--color-*-surface` and corresponding foreground token together for
  status badges. Do not rely on color alone to communicate status.
- Use `--color-control-border` for visible input, selection, and button
  boundaries; use `--color-focus` for keyboard focus indicators.
- Use `--color-text-placeholder` and `--color-disabled-text` for those
  respective text roles, rather than introducing new gray values.
- Existing shared controls include storefront search/filter, cart quantity,
  checkout, account, and review inputs; admin form fields and secondary
  actions use the same semantic roles.

## Responsive breakpoints

- Storefront layout changes at `1024px`, `800px`, and `480px`.
- Admin header/navigation layout changes at `900px`.
- Reduced-motion behavior is handled with `prefers-reduced-motion`.

The automated browser matrix is documented in
[`browser-compatibility.md`](./browser-compatibility.md). The design tokens do
not imply manual testing on physical devices.
