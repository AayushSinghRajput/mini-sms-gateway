# Mini SMS Gateway

A REST API that accepts SMS send requests, charges credits, delivers through mock providers with
priority-based **failover**, and **refunds** credits when a message fails on every route.

**Core guarantee: never lose or double-spend a credit.** Parallel requests, a failing route, or a crash
cannot leave a wallet wrong. This is enforced with atomic SQL, guarded state transitions and a ledger
(see [Design decisions](#design-decisions)) and proven by `npm run test:parallel` and `npm run verify:ledger`.

**Stack:** Next.js 15 (App Router, route handlers only) · TypeScript · PostgreSQL 16 · Prisma 6 (driver adapter) ·
zod · jose (JWT) · bcryptjs · Vitest.
**Bonus items:** B4 unit tests, B5 Docker Compose, B2 rate limiting.

---

## Quick start

### Option 1: Docker (one command)

```bash
docker compose up --build
```

This starts Postgres, applies migrations, seeds the 3 providers, then runs the API on
<http://localhost:3000> plus the reconciler (crash recovery). Stop with `Ctrl+C`; wipe data with `docker compose down -v`.

### Option 2: Local

Requires Node 20+ and Docker (for Postgres) or any local PostgreSQL 14+.

```bash
cp .env.example .env
docker compose up -d db          # or point DATABASE_URL at your own Postgres
npm install                      # also runs `prisma generate`
npx prisma migrate deploy        # applies prisma/migrations
npm run db:seed                  # seeds ROUTE_A / ROUTE_B / ROUTE_C
npm run dev                      # API on http://localhost:3000
npm run reconcile                # (second terminal) crash-recovery loop
```

### Run the tests

```bash
npm test                         # unit tests (counter, phone, failover, health, rate limit, mock provider)
npm run test:parallel            # needs the API running: 20 parallel sends vs a wallet that affords 10
npm run test:parallel -- --with-failures   # 50 sends with real failure rates; checks the ledger invariant
npm run verify:ledger            # asserts every wallet balance == its ledger, and refunds are consistent
```

### Demo helpers

```bash
npm run route:set -- ROUTE_A --failure 1          # force ROUTE_A to always fail
npm run route:set -- all --failure 1              # force every route to fail (triggers refunds)
npm run route:set -- all --failure 0              # no failures
npm run route:set -- ROUTE_A --balance 0          # route out of balance (gets skipped)
npm run wallet:topup -- user@example.com 50
```

### Deploying to Vercel

1. **Push to GitHub**: Push the repository to GitHub (`.env` must not be committed).
2. **Hosted Postgres**: Create a Postgres database (e.g. Neon via the Vercel Marketplace). Copy the **pooled** connection string.
3. **Migrate and seed**: Apply migrations and seed the mock providers from your laptop against that database:
   ```bash
   DATABASE_URL="<neon-pooled-url>" npx prisma migrate deploy
   DATABASE_URL="<neon-pooled-url>" npm run db:seed
   ```
   *(Note: if the pooled URL causes trouble for migrations, use Neon's direct connection string for this step only).*
4. **Import project in Vercel**: Import the repo in Vercel (framework Next.js, default build settings) and set environment variables:
   - `DATABASE_URL`: Hosted Postgres pooled connection string
   - `JWT_SECRET`: Long random secret string (single line)
   - `DEMO_CONTROLS`: `true` (demo only; allows reviewers to trigger failover/refunds via HTTP)
   - `CRON_SECRET`: Random secret string (for Vercel Cron authentication)
   - `ALLOW_DEV_TOPUP`: `true` (optional)
5. **Deploy and verify**: Run the end-to-end demo against the deployed URL:
   ```bash
   BASE_URL=https://<app>.vercel.app npm run demo
   ```
6. **Notes**:
   - Crash recovery runs via `GET /api/cron/reconcile` configured in `vercel.json` (daily on Vercel's Hobby free tier; on a paid plan it can be `* * * * *`).
   - `DEMO_CONTROLS` must be kept `false` in a real production environment.

### Try the live demo

Reviewers can verify the gateway without terminal access using either the one-line demo script or curl:

#### Option A: One-line test script
```bash
BASE_URL=https://<app>.vercel.app npm run demo
```
This tests registration, sends, Unicode SMS, validation rejection, failover, refunds, logs, and route health, then restores default route failure rates.

#### Option B: Step-by-step via curl
```bash
# 1. Register a reviewer account
curl -X POST "https://<app>.vercel.app/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"reviewer@example.com","password":"password123"}'
# Save the returned token as TOKEN

# 2. Check initial route health (including failure rates)
curl "https://<app>.vercel.app/api/routes/health" -H "authorization: Bearer $TOKEN"

# 3. Normal send (delivers via ROUTE_A)
curl -X POST "https://<app>.vercel.app/api/sms/send" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":["9841234567"],"message":"Standard send"}'

# 4. Failover: Force ROUTE_A to 100% failure rate
curl -X POST "https://<app>.vercel.app/api/demo/routes" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"ROUTE_A","failureRate":1}'

# Send again -> delivers via ROUTE_B with attempt "ROUTE_A:failed"
curl -X POST "https://<app>.vercel.app/api/sms/send" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":["9841234567"],"message":"Failover send"}'

# 5. Refund: Force all routes to 100% failure rate
curl -X POST "https://<app>.vercel.app/api/demo/routes" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"all","failureRate":1}'

# Send again -> status FAILED, refunded true, credits returned
curl -X POST "https://<app>.vercel.app/api/sms/send" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":["9841234567"],"message":"Refund send"}'

# Verify wallet balance was refunded
curl "https://<app>.vercel.app/api/wallet" -H "authorization: Bearer $TOKEN"

# 6. Check delivery logs for the failed/refunded SMS
curl "https://<app>.vercel.app/api/sms/logs?status=failed&limit=5" -H "authorization: Bearer $TOKEN"

# 7. Reset routes back to defaults
curl -X POST "https://<app>.vercel.app/api/demo/routes" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"ROUTE_A","failureRate":0.3}'
curl -X POST "https://<app>.vercel.app/api/demo/routes" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"ROUTE_B","failureRate":0.1}'
curl -X POST "https://<app>.vercel.app/api/demo/routes" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"ROUTE_C","failureRate":0.05}'
```

### Environment variables (`.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string |
| `JWT_SECRET` | required | HS256 signing secret |
| `JWT_EXPIRES_IN` | `24h` | Token lifetime |
| `STARTING_CREDITS` | `100` | Credits given at registration |
| `ALLOW_DEV_TOPUP` | `true` | Enables `POST /api/wallet/topup` (dev only) |
| `MAX_RECIPIENTS` | `100` | Max numbers per request |
| `MAX_PARTS_PER_MESSAGE` | `10` | Max SMS parts per message |
| `LOW_BALANCE_THRESHOLD` | `100` | Route balance below this lowers its health |
| `PENDING_STALE_SECONDS` | `120` | Age after which a PENDING message is recovered |
| `RECONCILE_INTERVAL_MS` | `30000` | Reconciler loop interval |
| `MOCK_LATENCY_MS` | `50` | Simulated provider latency |
| `SEND_CONCURRENCY` | `10` | Recipients processed in parallel per request |
| `RATE_LIMIT_PER_MINUTE` | `60` | Per-user limit on `POST /sms/send` |
| `DEMO_CONTROLS` | `false` | Enables `POST /api/demo/routes` (demo only; keep false in production) |
| `CRON_SECRET` | empty | Shared secret for `GET /api/cron/reconcile` (Vercel Cron) |

---

## API

All errors: `{ "error": { "code": "...", "message": "...", "details": {...} } }`.
Authenticated endpoints need `Authorization: Bearer <token>`.

| Status | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_NUMBERS` | bad input, invalid phone numbers, empty/too long message |
| 401 | `UNAUTHORIZED` | missing/invalid token, bad credentials |
| 402 | `INSUFFICIENT_CREDITS` | wallet cannot afford the request |
| 409 | `EMAIL_TAKEN` | duplicate registration |
| 429 | `RATE_LIMITED` | over the per-user limit (`Retry-After` header) |

### Auth and wallet

```bash
curl -X POST localhost:3000/api/auth/register -H 'content-type: application/json' \
  -d '{"email":"ram@example.com","password":"password123"}'      # -> { token, user }  (201, starts with 100 credits)
curl -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"ram@example.com","password":"password123"}'
curl localhost:3000/api/wallet -H "authorization: Bearer $TOKEN"  # -> { balance }
curl -X POST localhost:3000/api/wallet/topup -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"amount":50}'          # dev only (ALLOW_DEV_TOPUP=true)
```

### `POST /api/sms/send`

```bash
curl -X POST localhost:3000/api/sms/send -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"to":["9841234567","+9779801122334","9779761234567"],"message":"Hello from NestNepal"}'
```

```json
{
  "requestId": "…", "encoding": "GSM7", "partsPerMessage": 1, "costPerMessage": 1, "totalCost": 3,
  "summary": { "total": 3, "sent": 2, "failed": 1, "pending": 0, "refundedCredits": 1 },
  "duplicatesRemoved": 0, "balance": 98,
  "results": [
    { "messageId": "…", "to": "9841234567", "status": "SENT", "provider": "ROUTE_B",
      "attempts": ["ROUTE_A:failed", "ROUTE_B:sent"], "cost": 1, "refunded": false }
  ]
}
```

- Numbers are normalised (`+977`/`977` removed). **Any invalid number rejects the whole request** (400, with the list of
  invalid inputs); nothing is sent or charged.
- Duplicate numbers in one request are collapsed (`duplicatesRemoved`).
- Cost = SMS parts per message x number of recipients (1 credit per part).

### `GET /api/sms/logs`

Query params (all optional): `status=pending|sent|failed`, `from`, `to` (ISO date or datetime; a date-only `to` includes that
whole day), `number` (full number is matched exactly after normalisation; otherwise partial match), `page` (default 1),
`limit` (default 20, max 100). Only the caller's own messages are returned, newest first.

```bash
curl "localhost:3000/api/sms/logs?status=failed&from=2026-10-01&to=2026-10-31&page=1&limit=20" -H "authorization: Bearer $TOKEN"
```
Response: `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`.

### `GET /api/routes/health`

```json
{ "routes": [ { "name": "ROUTE_A", "priority": 1, "isActive": true, "balance": 9994,
  "failureRate": 0.3, "attempts24h": 8, "successRate24h": 50, "healthPercent": 50, "label": "DEGRADED" } ] }
```

### `POST /api/demo/routes` (demo only)

Disabled (returns 404) unless `DEMO_CONTROLS=true`. Lets a logged-in user adjust mock route failure rates, balance, or active status so that failover and refunds can be verified on a deployed instance.

```bash
# Force ROUTE_A to fail 100% of the time (demonstrates failover to ROUTE_B)
curl -X POST localhost:3000/api/demo/routes -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"ROUTE_A","failureRate":1}'

# Force all routes to fail 100% of the time (demonstrates refunds)
curl -X POST localhost:3000/api/demo/routes -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"all","failureRate":1}'
```

### `GET /api/cron/reconcile` (serverless crash recovery)

Disabled (returns 404) unless `CRON_SECRET` is set. Triggered by Vercel Cron with header `Authorization: Bearer <CRON_SECRET>` to recover stale `PENDING` messages and purge old rate-limit entries in serverless deployments.

```bash
curl localhost:3000/api/cron/reconcile -H "authorization: Bearer $CRON_SECRET"
# -> { "recovered": 0 }
```

---

## Design decisions

**Counting SMS parts** (`src/server/sms/segments.ts`, pure function). GSM-7 if every character is in the GSM 03.38 basic set
or its extension table, else Unicode. GSM-7: 160 chars in one SMS, 153 per part when longer. Unicode: 70 / 67.
Characters from the GSM extension table (`^ { } \ [ ~ ] | €`) count as 2 characters in GSM-7, as on real networks.
Unicode length is measured in UTF-16 code units, so an emoji counts as 2. One emoji makes the whole message Unicode.
Checked by tests: 200 English chars = 2 parts (153 + 47); 100 Nepali chars = 2 parts (67 + 33).

**Phone numbers** (`phone.ts`). 10 digits starting with 97 or 98; optional `+977` / `977` prefix is stripped. The prefix is
only stripped from 13-digit input, so a valid 10-digit number such as `9771234567` is not mangled.

**Atomic credit deduction.** One transaction contains a *single conditional UPDATE*:

```sql
UPDATE wallets SET balance = balance - $cost
WHERE user_id = $uid AND balance >= $cost
RETURNING balance;
```

There is no read-then-write. The row lock serialises parallel requests and the `balance >= cost` condition makes
overspending impossible: if no row comes back the request is rejected with 402. The same transaction creates the
`PENDING` message rows and the `DEBIT` ledger rows, so a charge can never exist without its messages. A `CHECK (balance >= 0)`
constraint is a second safety net. Credits are integers, never floats.

**Guarded state transitions.** A message moves `PENDING -> SENT` or `PENDING -> FAILED` only through `UPDATE ... WHERE status = 'PENDING'`.
So a message ends in exactly one final state, and only the winner of the `PENDING -> FAILED` transition refunds.

**Refund exactly once.** `refundMessage` runs `UPDATE messages SET status='FAILED', refunded=true ... WHERE id=$1 AND status='PENDING' AND refunded=false RETURNING cost`
and credits the wallet + writes the `REFUND` ledger row in the same transaction. If it returns no row, nothing happens. A unique index on
`credit_transactions (message_id, type)` also makes a second DEBIT or REFUND for the same message impossible at the database level.

**Failover.** For each message: active providers ordered by `priority`; a provider without enough balance is skipped; the provider's balance
is *reserved* with a conditional UPDATE before the send, and given back if the send fails; each attempt is recorded in `send_attempts`.
If every route fails, the message is refunded. The algorithm lives in `failover.ts` with an injected repository so it is unit tested
without a database.

**Ledger.** Every balance change (signup credit, top-up, debit, refund) writes a `credit_transactions` row, so
`wallet.balance == SUM(CREDIT) + SUM(REFUND) - SUM(DEBIT)` must always hold. `npm run verify:ledger` checks this plus refund consistency.

**Crash safety (reconciler).** If the process dies after the debit commits but before delivery, messages stay `PENDING`. `npm run reconcile`
finds `PENDING` messages older than `PENDING_STALE_SECONDS`, *claims* them with a guarded UPDATE (so several reconcilers cannot process the
same message), and runs the normal failover, which ends in `SENT` or a refund. Tested manually by inserting a debited-but-unsent message.

**Rate limiting (B2).** Fixed window per user, stored in Postgres (`rate_limits` table) so it works across several app instances with no Redis.
One atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`. Applies to `POST /sms/send`, runs *before* validation and before any debit, so a
`429` never touches credits. Old rows are purged by the reconciler. Weakness: a fixed window allows a burst of up to 2x the limit around a minute boundary.

**Sending is synchronous** inside the request (simple, and the response contains the final per-recipient result). `processMessage(id)` is standalone,
so a queue worker could call it later.

**Other choices.**
- Prisma runs with `engineType = "client"` and the `pg` driver adapter: no native engine binary, simpler Docker image.
- All timestamps are `timestamptz` so `now()` comparisons in raw SQL are unambiguous.
- Route handlers are thin; all logic is in `src/server/**` which does not import `next/*`.
- JWT is verified inside handlers (`requireUser`), not in Next middleware (Edge runtime limitations).

## Route health formula

```
successScore  = attempts24h > 0 ? successes24h / attempts24h : 1     (no data -> assume healthy)
balanceFactor = min(1, balance / LOW_BALANCE_THRESHOLD)
health %      = round(100 * successScore * balanceFactor)             (0 if the route is inactive)
label         = >= 80 HEALTHY, 50-79 DEGRADED, < 50 UNHEALTHY
```

Why multiply: a route that is accurate but nearly out of balance cannot carry traffic, and a route with plenty of balance that keeps failing
is not healthy either. Either problem pulls health down. Examples: 10/10 success with balance 25 and threshold 100 -> 25%; 7/10 success with
a full balance -> 70%.

## Project structure

```
src/app/api/**/route.ts      thin HTTP handlers
src/server/auth|wallet       JWT, passwords, wallet
src/server/sms               segments, phone, send, failover, process, refund, logs
src/server/providers         provider interface, mock provider
src/server/reports           route health
src/server/rate-limit        per-user limiter
prisma/                      schema, SQL migrations, seed
scripts/                     reconcile, parallel-test, verify-ledger, route-set, wallet-topup
tests/                       Vitest unit tests
```

## What I would improve

- A real queue (BullMQ) so `/sms/send` returns 202 immediately and workers deliver in the background, with retries and backoff.
- Delivery-report webhooks (`DELIVERED` / `UNDELIVERED`) and a policy for a late "failed" report after a message was marked `SENT`.
- Idempotency keys on `POST /sms/send` so client retries cannot double-charge.
- Sliding-window or token-bucket rate limiting (Redis) and per-route circuit breakers.
- Route health that also weighs latency and recent-window failures more than old ones.
- Partial-accept mode for invalid numbers (send the valid ones, report the rest).
- Provider balance reservations leak if the process crashes mid-send; reconcile provider balances against `send_attempts`.
- Metrics, structured logging, integration tests that run in CI against a real Postgres, real provider adapters.
