# MentorLagbe — Server

REST API for **MentorLagbe**, a tuition marketplace that connects students and tutors. The server is the authoritative system for authentication, role and ownership checks, tuition moderation, applications, plan entitlements, Stripe payments and image uploads. The web client is treated as untrusted.

- **Server repository:** `mentorlagbe-server` (this repo). Add the hosted Git URL here once pushed.
- **API base URL:** `http://localhost:5000/api/v1` locally. In production: `https://<your-host>/api/v1`
- **Auth base URL:** `http://localhost:5000/api/auth` (Better Auth)
- **Client:** `../mentorlagbe-client` (Next.js). It is already configured for these URLs.

## Technology stack

| Technology | Purpose |
|---|---|
| Node.js (>= 20) + TypeScript (ESM) | Runtime and static typing |
| Express 5 | HTTP server and routing (async errors handled natively) |
| MongoDB (official driver v7) | Business data storage |
| Better Auth (+ MongoDB adapter) | Email/password auth, HTTP-only cookie sessions |
| Zod 4 | Validation of request bodies, query strings and params |
| Stripe SDK | Checkout Sessions and signed webhooks |
| ImgBB API | Image hosting (server-side key) |
| Helmet, CORS, express-rate-limit | Security headers, origin allowlist, rate limits |
| Vitest, Supertest, mongodb-memory-server | Integration tests against a real in-memory MongoDB |

## Architecture decisions

These resolve the open decisions in [SERVER_PRD.md §23](SERVER_PRD.md).

| # | Decision |
|---|---|
| Auth integration | Better Auth is the only auth authority, mounted at `/api/auth/*`, with **cookie sessions**. The `authenticate` middleware calls `auth.api.getSession({ headers })`, which validates the signed cookie against the `sessions` collection. It then loads role and plan fresh from `users`. There is no parallel JWT system. Raw session tokens are stripped from Better Auth JSON responses, so page scripts can't read them. |
| One user record | Better Auth uses `usePlural: true`, so its user model **is** the business `users` collection. `role`, `plan`, `phone`, `bio` and `location` are Better Auth "additional fields". Credentials live only in Better Auth's `accounts` collection. |
| Role/plan safety | Sign-up accepts `role` only as `student` or `tutor`. `plan` is never accepted from a client, and new accounts are always `free`. Better Auth's generic `/update-user`, `/delete-user` and `/change-email` endpoints are disabled. Profile edits go through `PATCH /users/me`, which accepts only `name`, `phone`, `bio` and `location`. |
| Admin provisioning | Public sign-up can never create an admin. Admins are created or promoted with `npm run create-admin`. |
| Collections | Five business collections: `users`, `tuitions`, `applications`, `payments`, `bookmarks`. Better Auth also keeps `sessions`, `accounts` and `verifications`. |
| Billing | Student Pro ($10) and Tutor Pro ($15) are **one-time payments** (Stripe Checkout `mode: "payment"`) granting lifetime Pro. There's no recurring billing, so cancellation and expiry don't apply. Refunds are handled manually in the Stripe dashboard and don't downgrade the plan automatically. |
| Free tutor limit | A "qualifying post" is **any post that currently exists** for the tutor, whatever its approval or active status. Posts are hard-deleted, and deleting one frees a slot. |
| Priority booking | When a Pro student applies, the application is flagged `isPriority: true`. Tutors see priority applications first in `GET /applications/tutor`. |
| Re-moderation | Editing the content of an approved or rejected post sends it back to `pending`. Toggling `isActive` doesn't. |
| Cancellation | A student cancelling sets the status to `cancelled` (pending → cancelled only). A cancelled application can be re-opened by applying again. Any other duplicate gets a `409`. |
| Contact release | A tutor sees the student's phone only after accepting the application. Students see the tutor's email only after acceptance. |
| Images | Uploads are validated by size (2 MB) and **magic bytes** (JPEG/PNG/WebP/GIF), so the filename and MIME type aren't trusted. Images that get replaced are kept on ImgBB, because the API key can't delete them. Only the stored URL changes. |

## Project structure

```text
src/
├── app.ts                  # Express app factory (middleware order matters: webhook + auth before JSON)
├── server.ts               # Boot: connect DB, ensure indexes, init auth, listen, graceful shutdown
├── config/                 # env (Zod-validated), db, stripe, plans (server-side prices)
├── db/collections.ts       # Typed collections + all indexes (unique constraints)
├── lib/auth.ts             # Better Auth configuration
├── middlewares/            # authenticate, authorize, require-ownership, validate, error-handler, rate-limit, request-context
├── modules/
│   ├── auth/               # Mounts Better Auth; GET /auth/session
│   ├── users/              # /users/me profile + avatar
│   ├── tuitions/           # Public listing, tutor CRUD, moderation service
│   ├── applications/       # Apply, list, cancel, accept/reject
│   ├── bookmarks/          # Student bookmarks with free-plan limit
│   ├── payments/           # Checkout, status, Stripe webhook
│   ├── plans/              # Public plan catalog
│   ├── uploads/            # ImgBB upload + validation
│   └── admin/              # Dashboard, users, roles, moderation, payments
├── routes/index.ts         # /api/v1 router
├── types/                  # Domain models, Express request augmentation
└── utils/                  # AppError, responses, logger, query helpers
scripts/                    # seed.ts, create-admin.ts
tests/                      # Integration tests (one in-memory MongoDB, one database per file)
```

Each module keeps business rules in its `*.service.ts`. Routes stay thin: validate, authorize, then call the service.

## API conventions

- JSON in and out. The exceptions are multipart uploads (`image` field) and the Stripe webhook (raw body).
- Success: `{ "success": true, "message": "...", "data": ... }`. Lists add `"meta": { page, limit, total, totalPages, hasNextPage }`.
- Error: `{ "success": false, "message": "...", "code": "MACHINE_CODE", "errors": [{ "field", "message" }] | null, "requestId": "..." }`.
- Status codes: `200` read/update · `201` create · `400` validation (`VALIDATION_ERROR`) · `401` no or expired session · `403` wrong role or not the owner · `404` · `409` duplicate, plan limit or invalid state transition · `413` payload too large · `429` rate limited · `502` upstream (Stripe/ImgBB) failure · `503` feature not configured · `500` (safe message, never a stack in production).
- Each response carries an `X-Request-Id` header, which also appears in logs.
- Pagination: `page` (default 1) and `limit` (default 10, max 50).

## API route summary

The client's contract ([../mentorlagbe-client/docs/api-contract.md](../mentorlagbe-client/docs/api-contract.md)) and the PRD use different paths in a few places. **Both are served.** Aliases are shown after `·`.

### Auth (Better Auth, `/api/auth`)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/sign-up/email` | `{ name, email, password, role: "student"\|"tutor", phone? }` |
| POST | `/api/auth/sign-in/email` | `{ email, password, rememberMe? }` sets an HTTP-only cookie |
| POST | `/api/auth/sign-out` | |
| GET | `/api/auth/get-session` | Session + user (role, plan) |
| POST | `/api/auth/change-password` | |
| GET | `/api/v1/auth/session` | Verified session's business user |

### Users
| Method | Path | Access |
|---|---|---|
| GET | `/users/me` | Authenticated |
| PATCH | `/users/me` | Authenticated: `name`, `phone`, `bio`, `location` only |
| POST | `/users/me/avatar` | Authenticated, multipart `image` |

### Tuitions
| Method | Path | Access |
|---|---|---|
| GET | `/tuitions` | Public. Approved + active only. `search, subject, classLevel, mode, location, minFee, maxFee, page, limit, sort` (`newest`, `oldest`, `fee_asc`, `fee_desc`) |
| GET | `/tuitions/featured?limit=3` | Public (Pro tutors first) |
| GET | `/tuitions/:id` | Public if approved + active; the owner and admins can also see unpublished posts |
| POST | `/tuitions` | Tutor (free plan: max 2 posts) |
| GET | `/tuitions/mine` · `/tutor/tuitions` | Tutor's own posts. `search, status, isActive, page, limit, sort` |
| PATCH | `/tuitions/:id` | Owner tutor (partial; content edits trigger re-moderation) |
| PATCH | `/tuitions/:id/status` | Owner tutor: `{ isActive }` |
| POST | `/tuitions/:id/banner` | Owner tutor, multipart `image` |
| DELETE | `/tuitions/:id` | Owner tutor (also deletes the post's applications and bookmarks) |
| POST | `/tuitions/:id/apply` | Student: `{ message?, preferredSchedule?, phone? }` |

### Applications
| Method | Path | Access |
|---|---|---|
| POST | `/applications` | Student: `{ tuitionId, preferredSchedule?, studentNote?, phone? }` |
| GET | `/applications/my` · `/applications/me` | Student's own |
| GET | `/applications/tutor` | Applicants on the tutor's own posts (priority first) |
| GET | `/applications/:id` | Student owner, owning tutor, or admin |
| PATCH | `/applications/:id/cancel` · `DELETE /applications/:id` | Student owner, pending only |
| PATCH | `/applications/:id/accept` · `/reject` · `/status {status}` | Owning tutor, pending only |

### Bookmarks (student only)
| Method | Path | Notes |
|---|---|---|
| GET | `/bookmarks` | Includes tuition data; `meta.bookmarkLimit` is `5` or `null` |
| POST | `/bookmarks` `{ tuitionId }` · `/bookmarks/:tuitionId` | Free: max 5. Tuition must be approved + active |
| DELETE | `/bookmarks/:id` | `:id` may be the bookmark id or the tuition id |
| DELETE | `/bookmarks/tuition/:tuitionId` | |

### Plans and payments
| Method | Path | Access |
|---|---|---|
| GET | `/plans` | Public |
| POST | `/payments/create-checkout-session` · `/payments/checkout` | Student/Tutor: `{ plan: "student_pro"\|"tutor_pro" }` returns `{ url, sessionId, paymentId }` |
| GET | `/payments/status?session_id=cs_...` | Purchaser only. Read-only, **never** grants a plan |
| GET | `/payments/my` | Authenticated |
| POST | `/payments/webhook` | Stripe only (signature verified on the raw body) |

### Uploads
| Method | Path | Access |
|---|---|---|
| POST | `/uploads/image` | Authenticated, multipart `image` returns the hosted URL |

### Admin (all require an admin session)
| Method | Path |
|---|---|
| GET | `/admin/dashboard` · `/admin/stats` |
| GET | `/admin/users` (`search, role, plan, page, limit`) · `/admin/users/:id` |
| PATCH | `/admin/users/:id/role` · `/admin/users/:id`: `{ role }` (no self-change; the last admin is protected; changes recorded in `roleHistory`) |
| GET | `/admin/tuitions` (`search, status, isActive, tutorId, page, limit, sort`) |
| PATCH | `/admin/tuitions/:id/approve` · `/reject {reason}` · `/moderate {status, reason?}` (recorded in `moderationHistory`) |
| GET | `/admin/payments` · `/admin/transactions` |

Also available: `GET /api/v1/health`, which reports database status.

## Payment flow

1. The client calls `POST /payments/checkout { plan }`.
2. The server loads role and plan from the DB, checks that the plan matches the role and that the user isn't already Pro, and reads the price from `src/config/plans.ts`.
3. It inserts a `pending` payment and creates a Stripe Checkout Session. The metadata holds `paymentId`, `userId` and `plan`, and an idempotency key is set.
4. The browser goes to Stripe, then returns to `/payment/success?session_id=...`. The success page only **reads** `/payments/status`.
5. Stripe calls `POST /api/v1/payments/webhook`. The server verifies the signature on the raw body, then checks `payment_status`, `amount_total`, `currency`, `mode` and the metadata (user, plan, payment) against the stored payment.
6. Only then does it set `users.plan = "pro"` and mark the payment `paid`. Processed event ids are stored on the payment, and a replayed event returns `duplicate` with no effect. A mismatch marks the payment `failed` without upgrading.

Handled events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.

## Database setup

Use MongoDB 6+ (local `mongod`, Docker, or MongoDB Atlas). On startup the server creates every index the rules depend on, including:

- `users.email` (unique)
- `applications { tuitionId, studentId }` (unique, blocks concurrent duplicate applications)
- `bookmarks { studentId, tuitionId }` (unique)
- `payments.stripeSessionId` (unique, partial)
- Listing indexes on `tuitions` (`approvalStatus + isActive + createdAt`, `tutorId`, `subject`, `location`, `monthlyFee`) and lookup indexes on `applications` and `payments`

The free-plan limits are re-checked after insert, so concurrent requests can't go over the limit.

Local MongoDB with Docker:

```bash
docker run -d --name mentorlagbe-mongo -p 27017:27017 mongo:8
```

## Environment variables

Copy `.env.example` to `.env` and fill in values. Never commit `.env`.

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | no | `development` (default), `test` or `production` |
| `PORT` | no | Default `5000` |
| `TRUST_PROXY` | no | Number of reverse-proxy hops (set `1` behind Render, Railway, Heroku and similar) |
| `CLIENT_URL` | yes | Comma-separated CORS / trusted-origin allowlist. The first entry is used for Stripe redirects |
| `MONGODB_URI` | yes | MongoDB connection string |
| `MONGODB_DB_NAME` | no | Default `mentorlagbe` |
| `BETTER_AUTH_SECRET` | yes | ≥ 32 random characters |
| `BETTER_AUTH_URL` | yes | Public base URL of this server (e.g. `http://localhost:5000`) |
| `STRIPE_SECRET_KEY` | for payments | Stripe secret key (`sk_test_...` in development) |
| `STRIPE_WEBHOOK_SECRET` | for payments | Signing secret of the webhook endpoint (`whsec_...`) |
| `STRIPE_CURRENCY` | no | Default `usd` |
| `IMGBB_API_KEY` | for uploads | ImgBB API key |
| `SEED_DEMO_PASSWORD` | no | Password for seeded demo accounts (otherwise random) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | for `create-admin` | Admin provisioning |

If Stripe or ImgBB isn't configured, the server still starts. The related endpoints return `503`.

## Local installation

```bash
npm install
cp .env.example .env
# set MONGODB_URI and generate a secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → BETTER_AUTH_SECRET

npm run dev          # watch mode (tsx) on http://localhost:5000
npm run build        # compile to dist/
npm start            # run the compiled server
npm run typecheck
```

Then run the client (`../mentorlagbe-client`) with `npm run dev`. Its default env already points at `http://localhost:5000`.

### Stripe webhooks locally

```bash
stripe listen --forward-to localhost:5000/api/v1/payments/webhook
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET and restart the server
```

## Seed data

```bash
npm run seed              # add demo data (idempotent for users)
npm run seed -- --reset   # wipe the database first (refused when NODE_ENV=production)
```

The seed creates:

- 1 admin
- 4 students (one Pro)
- 4 tutors (one Pro)
- 12 approved and active tuitions, plus 1 pending, 1 rejected and 1 inactive
- 8 applications: pending, accepted, rejected and cancelled
- 4 payments marked `isDemo: true` (never real charges; excluded from revenue)

**Demo credentials:** the accounts use the `@mentorlagbe.test` domain, and the seed prints them, e.g. `admin@mentorlagbe.test`, `ayesha.student@mentorlagbe.test`, `kamal.tutor@mentorlagbe.test`. The password is your `SEED_DEMO_PASSWORD`. If that's unset, a random password is generated and printed once, so there's no publicly known default. Don't seed production.

### Creating a real admin

```bash
ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='a-long-strong-password' npm run create-admin
```

If the email already exists, that user is promoted. Without `ADMIN_PASSWORD`, a random password is generated and printed once.

## Tests

```bash
npm test
```

There are 91 integration tests. They exercise the real app (Better Auth, Express, MongoDB) against an in-memory MongoDB. Stripe and ImgBB HTTP calls are stubbed, and Stripe webhook signatures are generated with the real SDK. Coverage:

- Registration, login and sign-out; expired, forged and revoked sessions; admin self-registration blocked; plan injection ignored
- Student, tutor and admin permissions; tuition ownership on update and delete
- Public listing excludes pending, rejected and inactive posts; filters, sorting, pagination validation, regex-safe search
- Tutor free limit of 2 (including concurrent requests); Pro unlimited; deleting a post frees a slot
- Student free bookmark limit of 5 (including concurrent requests); duplicates; ineligible tuitions
- Duplicate application prevention, including 6 concurrent requests; cancel and decision state transitions; cross-tutor access denied; priority ordering; contact release
- Stripe: server-side pricing, role/plan mismatch, invalid signatures, upgrade only via webhook, idempotent replays, amount and user mismatch rejection, expired sessions
- Uploads: auth, MIME allowlist, magic-byte check, size limit, provider error and timeout, banner ownership
- Admin: access control, stats, role changes with history, no self-change, last-admin protection under a concurrent race
- App: health, 404s, malformed JSON, body size limit, CORS allowlist, security headers, no internals leaked in 500s, unreachable-database failure

> **Known environment issue (Windows + Node 24.15):** on the development machine, a long run of authenticated HTTP requests occasionally aborted the Node process natively (`0xC0000409`). Vitest reports this as "Worker exited unexpectedly". It reproduced with the compiled `dist/` build under plain `node`, outside the test runner. It did not reproduce with Express, the MongoDB driver, WebCrypto or `node:http` in isolation, and the code is pure JavaScript. When it happens, re-run `npm test`. Any test that runs reports pass or fail normally. Trying Node 22 LTS on Windows, or running CI on Linux, is recommended.

## Deployment

Any Node.js host works (Render, Railway, Fly.io, a VPS). Example for Render:

1. Create a **Web Service** from this repo.
   - Build: `npm ci && npm run build`
   - Start: `npm start`
   - Node 20+
2. Set the environment variables from the table above:
   - `NODE_ENV=production`
   - `TRUST_PROXY=1`
   - `BETTER_AUTH_URL=https://<api-host>`
   - `CLIENT_URL=https://<client-host>`
   - `MONGODB_URI` (Atlas)
   - The Stripe live or test keys and `IMGBB_API_KEY`
3. In the Stripe Dashboard, add a webhook endpoint `https://<api-host>/api/v1/payments/webhook` for the four `checkout.session.*` events. Then set `STRIPE_WEBHOOK_SECRET`.
4. Provision an admin by running `npm run create-admin` once against the production database from a trusted shell.
5. Point the client at the server:
   - `NEXT_PUBLIC_API_URL=https://<api-host>/api/v1`
   - `NEXT_PUBLIC_BETTER_AUTH_URL=https://<api-host>`

In production, cookies are `Secure; HttpOnly; SameSite=None`, so the client and API can live on different sites over HTTPS. Better Auth's rate limiter and the Express rate limiters are active. Error responses never include stack traces.

## Security summary

- Every protected route verifies the session server-side. Role, ownership and plan come from the database on each request.
- Zod parses every body, query and param, and unknown keys are dropped. Services build updates from explicit allowlists (no mass assignment). User search input is regex-escaped. Express 5's simple query parser prevents nested-object operator injection.
- Security headers come from Helmet. CORS uses an allowlist with credentials. JSON bodies are capped at 100 kb. Uploads are limited to 2 MB with content verified.
- Rate limits apply to the API in general, plus tighter limits on auth, checkout and uploads.
- Logs are structured JSON with request ids. Passwords, tokens, secrets, cookies and signatures are redacted. Moderation, role changes and webhook outcomes are logged.
