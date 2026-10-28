# Mini SMS Gateway

> A resilient, high-concurrency REST API for SMS routing: credit wallet, multi-provider priority failover, automatic refunds, crash recovery, and dynamic route health.  
> Built for the **NestNepal Backend Engineering** take-home assessment.

**Live Deployment:** <https://sms-gateway-topaz.vercel.app>  
**Stack:** Next.js 15 (App Router, Route Handlers) · TypeScript · PostgreSQL 16 / Neon · Prisma 6 · Zod · Jose (JWT) · Vitest · Docker

---

## ⚡ Quick Test for Reviewers (One Command)

You can verify the entire live deployment — registration, sends, Nepali Unicode SMS, phone validation, provider failover, and automatic refunds — without setting up a database:

```bash
git clone https://github.com/AayushSinghRajput/mini-sms-gateway.git
cd mini-sms-gateway/sms-gateway && npm install
BASE_URL="https://sms-gateway-topaz.vercel.app" npm run demo
```

*(Takes ~5 seconds and restores provider failure rates to defaults when finished).*

---

## 🎯 Core Guarantees & Highlights

1. **Zero Double-Spending & No Lost Credits:** Wallet deductions occur via a single atomic SQL statement (`UPDATE wallets SET balance = balance - $cost WHERE balance >= $cost`). Parallel requests, failures, or crashes cannot corrupt balances.
2. **Double-Entry Ledger:** Every credit event (signup bonus, send debit, refund, top-up) writes an immutable row to `credit_transactions`. Balance always equals `SUM(CREDIT) + SUM(REFUND) - SUM(DEBIT)`.
3. **Smart Priority Failover:** Routes are dispatched in priority order (`ROUTE_A` -> `ROUTE_B` -> `ROUTE_C`). Provider balances are reserved before sending and restored if an attempt fails.
4. **Guaranteed Atomic Refunds:** If every route fails, the message transitions `PENDING -> FAILED` with `refunded = true` and credits are returned to the user in the same database transaction.
5. **Crash Recovery (Reconciler):** Any message left `PENDING` due to a sudden server crash is picked up after `PENDING_STALE_SECONDS`, claimed with a guarded update, and delivered or refunded.
6. **Per-User Rate Limiting (Bonus B2):** Atomic PostgreSQL rate limiting per user on `POST /api/sms/send` without external Redis dependencies.

---

## 🧪 Testing Suite

Run tests inside `sms-gateway/`:

```bash
# 1. Unit Tests (Bonus B4) - 47 tests (encoding, phone, failover, health, limiter)
npm test

# 2. Concurrency Stress Test - 20 parallel requests against a wallet with only 10 credits
npm run test:parallel

# 3. Double-Spend & Invariant Proof - 50 requests with failures, verifying ledger integrity
npm run test:parallel -- --with-failures

# 4. Ledger Audit - Mathematically validates all wallet balances against credit transactions
npm run verify:ledger
```

---

## 🎮 Live Demo Walkthrough (curl)

If you prefer testing endpoints manually against the live deployment:

<details>
<summary><b>Click to expand step-by-step curl commands</b></summary>

```bash
BASE="https://sms-gateway-topaz.vercel.app"

# 1. Register a reviewer account (gives 100 credits)
TOKEN=$(curl -s -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"reviewer@example.com","password":"password123"}' | jq -r .token)

# 2. Check initial route health (shows failure rates & balances)
curl -s "$BASE/api/routes/health" -H "authorization: Bearer $TOKEN" | jq .

# 3. Standard send (delivers via ROUTE_A)
curl -s -X POST "$BASE/api/sms/send" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"to":["9841234567"],"message":"Standard send"}' | jq .

# 4. Failover: Force ROUTE_A to fail 100% of the time
curl -s -X POST "$BASE/api/demo/routes" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"ROUTE_A","failureRate":1}' | jq .

# Send again -> delivered via ROUTE_B (attempts: ["ROUTE_A:failed", "ROUTE_B:sent"])
curl -s -X POST "$BASE/api/sms/send" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"to":["9841234567"],"message":"Failover send"}' | jq .

# 5. Refund: Force all routes to fail 100% of the time
curl -s -X POST "$BASE/api/demo/routes" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"all","failureRate":1}' | jq .

# Send again -> status: FAILED, refunded: true, wallet balance unchanged
curl -s -X POST "$BASE/api/sms/send" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"to":["9841234567"],"message":"Refund send"}' | jq .

# Check wallet balance (credits were safely refunded)
curl -s "$BASE/api/wallet" -H "authorization: Bearer $TOKEN" | jq .

# 6. Check logs for the failed & refunded message
curl -s "$BASE/api/sms/logs?status=failed&limit=5" -H "authorization: Bearer $TOKEN" | jq .

# 7. Restore original seed rates
curl -s -X POST "$BASE/api/demo/routes" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"ROUTE_A","failureRate":0.3}' > /dev/null
curl -s -X POST "$BASE/api/demo/routes" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"ROUTE_B","failureRate":0.1}' > /dev/null
curl -s -X POST "$BASE/api/demo/routes" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"ROUTE_C","failureRate":0.05}' > /dev/null
```
</details>

---

## 💻 Local Setup

### Option 1: Docker Compose (Bonus B5 — One Command)
```bash
cd sms-gateway
docker compose up --build
```
Starts PostgreSQL 16, runs migrations, seeds providers, and starts the API on <http://localhost:3000> along with the background reconciler.

### Option 2: Local Node.js
```bash
cd sms-gateway
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev                  # API on http://localhost:3000
npm run reconcile            # (Optional second terminal) crash recovery daemon
```

---

## ☁️ Deploying to Vercel

1. Push this repository to GitHub.
2. Create a hosted database (such as **Neon** via the Vercel Marketplace) and copy the connection string.
3. Apply migrations and seed from your terminal:
   ```bash
   cd sms-gateway
   DATABASE_URL="<neon-url>" npx prisma migrate deploy
   DATABASE_URL="<neon-url>" npm run db:seed
   ```
4. Import project in Vercel with **Root Directory set to `sms-gateway`** and configure environment variables:
   - `DATABASE_URL`: Hosted Postgres connection string
   - `JWT_SECRET`: Random 256-bit secret string
   - `DEMO_CONTROLS`: `true` (enables route adjustment endpoint for reviewers)
   - `CRON_SECRET`: Secret token for Vercel Cron
   - `ALLOW_DEV_TOPUP`: `true`
5. Vercel Cron automatically runs serverless crash recovery via `GET /api/cron/reconcile` (configured in `vercel.json`).

---

## 📡 API Reference

All requests accept/return JSON. Protected endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register` | Register new user (grants 100 starting credits) | No |
| `POST` | `/api/auth/login` | Login and obtain JWT token | No |
| `GET` | `/api/wallet` | Check current credit balance | Yes |
| `POST` | `/api/wallet/topup` | Add credits (dev only, `ALLOW_DEV_TOPUP=true`) | Yes |
| `POST` | `/api/sms/send` | Send SMS to up to 100 recipients with failover | Yes |
| `GET` | `/api/sms/logs` | Query delivery history (supports pagination & status filters) | Yes |
| `GET` | `/api/routes/health` | Provider health stats, balance, and failure rates | Yes |
| `POST` | `/api/demo/routes` | Set route failure rates on demand (`DEMO_CONTROLS=true`) | Yes |
| `GET` | `/api/cron/reconcile`| Serverless crash recovery endpoint (Vercel Cron) | Bearer Secret |

---

## 📐 Architecture & Design Decisions

### 1. Atomic Credit Deductions
Credits are debited in a single conditional SQL update:
```sql
UPDATE wallets SET balance = balance - $cost, updated_at = now()
WHERE user_id = $uid AND balance >= $cost
RETURNING balance;
```
- Row-level locking serializes concurrent sends from the same user.
- If `balance < cost`, zero rows return and the request immediately aborts with `402 INSUFFICIENT_CREDITS`.
- A database-level `CHECK (balance >= 0)` constraint serves as a redundant invariant safeguard.

### 2. Guarded State Transitions & Single Refund
Messages start in `PENDING`. Transitions to `SENT` or `FAILED` require a conditional check:
```sql
UPDATE messages SET status = 'FAILED', refunded = true, updated_at = now()
WHERE id = $id AND status = 'PENDING' AND refunded = false
RETURNING cost;
```
If two processes race to handle the same message, only one can match `status = 'PENDING'`. A database-level unique index on `credit_transactions (message_id, type)` prevents duplicate refunds.

### 3. Priority Failover Algorithm
1. Active providers are queried ordered by priority (`ROUTE_A: 1`, `ROUTE_B: 2`, `ROUTE_C: 3`).
2. Providers with insufficient balance are skipped.
3. Provider balance is atomically reserved before delivery and refunded if the mock attempt fails.
4. Each attempt is logged in `send_attempts` for transparency.

### 4. SMS Character & Part Counting
- **GSM-7:** 160 characters for a single SMS; 153 characters per segment for multi-part messages. GSM extension characters (`^ { } \ [ ~ ] | €`) count as 2 characters.
- **Unicode:** If any non-GSM character is detected (e.g. Nepali `न` or emojis), encoding switches to Unicode: 70 characters for single-part, 67 characters per segment for multi-part.
- Unit tested across English, special characters, and Nepali scripts.

### 5. Phone Normalisation
Validates Nepali mobile numbers (10 digits starting with `97` or `98`). Automatically strips `+977` and `977` prefixes. Invalid numbers reject the entire batch with `400 INVALID_NUMBERS` before any balance is charged.

### 6. Crash Safety (Reconciler)
If an application container crashes mid-send:
- Messages older than `PENDING_STALE_SECONDS` are claimed using a guarded timestamp update (`updated_at = now()`).
- The reconciler resumes processing through failover, resulting in either a successful delivery or an automatic refund.

---

## 📊 Route Health Formula

Route health combines past delivery performance with remaining provider liquidity:

$$\text{successScore} = \begin{cases} \frac{\text{successes}_{24h}}{\text{attempts}_{24h}} & \text{if } \text{attempts}_{24h} > 0 \\ 1 & \text{if no data} \end{cases}$$

$$\text{balanceFactor} = \min\left(1, \frac{\text{balance}}{\text{LOW\_BALANCE\_THRESHOLD}}\right)$$

$$\text{healthPercent} = \text{round}(100 \times \text{successScore} \times \text{balanceFactor})$$

$$\text{label} = \begin{cases} \text{HEALTHY} & \ge 80\% \\ \text{DEGRADED} & 50\% - 79\% \\ \text{UNHEALTHY} & < 50\% \end{cases}$$

**Why multiply?** A route with 100% success rate that has zero balance is unusable (0%). A route with full balance that constantly drops messages is degraded. Both liquidity and reliability pull the health score down realistically.

---

## 🔮 What I Would Improve

1. **Asynchronous Message Queue:** Offload `/api/sms/send` to BullMQ / AWS SQS workers with exponential backoff and dead-letter queues.
2. **Delivery Receipts (DLR):** Ingest carrier delivery webhooks to track `DELIVERED` vs `UNDELIVERED` post-send.
3. **Idempotency Keys:** Support `Idempotency-Key` headers on dispatch endpoints to prevent duplicate charges from network retries.
4. **Redis Sliding-Window Rate Limiting & Circuit Breakers:** Implement token-bucket rate limiting and automatic circuit tripping for failing routes.
5. **Decayed Health Scoring:** Weight recent 15-minute failures higher than 24-hour historical failures.
