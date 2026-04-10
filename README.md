# AlohaOneApp

The unified application layer for the AlohaOne ecosystem — account, platform
enablement, billing, and activity across every AlohaOne platform.

Part of the two-layer architecture:

```
alohaone.ai        ← Marketing (C:\Source\Aloha\AlohaOne)
    │
    ▼  Start Free Trial / Register Now
app.alohaone.ai    ← This app (C:\Source\Aloha\AlohaOneApp)
    │
    ▼  Launch platform
platform apps      ← AlohaCommerce, AlohaDocument, etc.
```

## Stack

Plain HTML / CSS / vanilla JS with Bootstrap 5.3.3 and Font Awesome 6.5.1.
No build step, no framework, no server-side rendering. Matches the
[AlohaCommerce admin](../AlohaCommerce/alohacommerce-admin/) layout pattern.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Router entry — redirects based on auth state and `?platform=` param |
| `login.html` | Sign in (stubbed — any email/password works in dev) |
| `register.html` | Create account (stubbed — creates a local user) |
| `dashboard.html` | Home: enabled platforms, usage, monthly cost, recent activity |
| `platforms.html` | Full platform catalog with enable state for each |
| `enable.html` | **Key CTA landing page** — toggle capabilities and enable a platform (`?platform=slug`) |
| `account.html` | Profile, password, danger zone (reset local data) |
| `billing.html` | Monthly charges computed from enabled paid platforms, payment method, invoices |
| `history.html` | Activity log of every account event |

## CTA flow from marketing site

The marketing site's "Start Free Trial" / "Register Now" / "Enable in AlohaOne"
buttons all link to:

```
../../AlohaOneApp/index.html?platform=<slug>&intent=register
```

`index.html` inspects the query params and redirects:

| State | Destination |
|---|---|
| Authenticated + `?platform=commerce` | `enable.html?platform=commerce` |
| Authenticated (no platform) | `dashboard.html` |
| Unauthenticated + `intent=register` + `?platform=commerce` | `register.html?next=enable.html?platform=commerce` |
| Unauthenticated + `?platform=commerce` (no intent) | `login.html?next=enable.html?platform=commerce` |
| Unauthenticated (no platform) | `login.html` |

After login/register, the user lands on `enable.html?platform=<slug>` and can
turn capabilities on with a single click.

## Auth

**Currently stubbed** — `js/alohaone.js` uses `localStorage` to simulate user
sessions. Any email + password combination creates a session.

When the shared AlohaOne Cognito identity pool is ready, replace `stubLogin`
and `stubRegister` with real Cognito calls. The rest of the app already uses
token/user helpers (`getToken`, `getUser`, `setUser`, etc.) so the swap will
be localized to those two functions.

## Shared data

`js/platforms-data.js` is the catalog used by dashboard, platforms list, and
enable page. **Add a new AlohaOne platform:** append one entry to the
`PLATFORMS` array with `slug`, `name`, `icon`, `color`, `gradient`, `status`,
`tagline`, `capabilities`, `pricing`. The app rebuilds automatically.

Keep this in sync with `../AlohaOne/generate_platforms.py` and
`../AlohaOne/js/main.js` (brain viz) until the data is unified behind an API.

## localStorage keys

| Key | Purpose |
|---|---|
| `ao_token` | Session token (stub or JWT) |
| `ao_user` | User object `{ email, displayName, plan, createdAt }` |
| `ao_enabled_platforms` | Array of platform slugs the user has enabled |
| `ao_enabled_capabilities` | `{ platformSlug: [capId, capId, ...] }` |
| `ao_activity_log` | Array of `{ type, payload, at }` events (capped at 200) |

## Tropical branding

The sidebar brand renders "Aloha" in white followed by "One" in the tropical
gradient (ocean teal → hibiscus pink → sunset orange), matching the marketing
site wordmark. The gradient is defined as `--ao-gradient` in `css/alohaone.css`.
