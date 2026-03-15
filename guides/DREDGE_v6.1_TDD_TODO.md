# DREDGE v6.1 — Stabilisation: TDD Todo Guide

> **Approach:** Red → Green → Refactor throughout. Write the test first, watch it fail, implement the minimum code to pass, then clean up. Each section ends with a git commit at a logical checkpoint.

---

## Prerequisites

Before starting, ensure your environment is ready:

- [ ] Redis is running locally (`docker run -d -p 6379:6379 redis:alpine` if needed)
- [ ] `REDIS_URL=redis://localhost:6379` is set in your local `.env`
- [ ] Integration tests point at a dedicated test Redis instance via `REDIS_URL_TEST` to avoid polluting dev data
- [ ] Existing test suite passes cleanly on `main`

```bash
# Confirm clean baseline
git checkout main
git pull
pnpm test
```

---

## Step 1 — Branch setup

```bash
git checkout -b feat/v6.1-redis-stabilisation
```

---

## Step 2 — Install dependencies

- [ ] Install `ioredis` and its types
- [ ] Install `rate-limiter-flexible`

```bash
pnpm add ioredis --filter orchestrator
pnpm add -D @types/ioredis --filter orchestrator
pnpm add rate-limiter-flexible --filter orchestrator
```

```bash
git add package.json pnpm-lock.yaml packages/*/package.json
git commit -m "chore(v6.1): install ioredis and rate-limiter-flexible"
```

---

## Step 3 — Shared Redis client (`redis.ts`)

### 3.1 Write the tests first

Create `apps/orchestrator/src/__tests__/redis.test.ts`:

- [ ] **Test: client connects successfully when REDIS_URL is valid**
  - Call `getRedisClient()`
  - Expect the client status to be `"ready"` after a short await
  - Tear down: call `client.quit()` in `afterAll`

- [ ] **Test: health check returns `true` when Redis is reachable**
  - Call `checkRedisHealth()`
  - Expect it to resolve to `true`

- [ ] **Test: health check returns `false` when Redis is unreachable**
  - Instantiate a client pointed at an invalid host/port
  - Call `checkRedisHealth(client)`
  - Expect it to resolve to `false` within a timeout
  - Confirm it does not throw

- [ ] **Test: `getRedisClient()` returns the same instance on repeated calls (singleton)**
  - Call `getRedisClient()` twice
  - Expect `clientA === clientB`

Run tests — confirm they all **fail** (red).

### 3.2 Implement `redis.ts`

Create `apps/orchestrator/src/redis.ts`:

- [ ] Create a singleton `ioredis` client using `process.env.REDIS_URL`
- [ ] Set `lazyConnect: true`, `maxRetriesPerRequest: 1`, and a short `connectTimeout` so failed health checks do not hang
- [ ] Export `getRedisClient()` returning the singleton
- [ ] Export `checkRedisHealth(client?)` — pings Redis and returns a boolean, never throws

Run tests — confirm they all **pass** (green).

```bash
git add apps/orchestrator/src/redis.ts apps/orchestrator/src/__tests__/redis.test.ts
git commit -m "feat(v6.1): add shared Redis client with health check (redis.ts)"
```

---

## Step 4 — Redis-backed rate limiter (`rateLimiter.ts`)

### 4.1 Write the tests first

Create `apps/orchestrator/src/__tests__/rateLimiter.test.ts`:

- [ ] **Test: `consume()` succeeds when under the limit**
  - Create a limiter with a high points ceiling
  - Call `consume("test-key")`
  - Expect it to resolve without throwing

- [ ] **Test: `consume()` throws `RateLimitError` when limit is exceeded**
  - Create a limiter with `points: 2, duration: 10`
  - Call `consume("burst-key")` three times in rapid succession
  - Expect the third call to throw with a recognisable rate limit error

- [ ] **Test: two separate limiter instances share state via Redis**
  - Create `limiterA` and `limiterB` with the same key prefix, both pointed at the test Redis
  - Exhaust the limit via `limiterA`
  - Call `consume()` on `limiterB` with the same key
  - Expect it to be blocked — confirming shared state across instances

- [ ] **Test: falls back to in-memory mode when Redis client is not connected**
  - Pass a disconnected Redis client to the limiter factory
  - Call `consume()`
  - Expect it to succeed (in-memory fallback, not a crash)

Run tests — confirm **fail** (red).

### 4.2 Update `rateLimiter.ts`

- [ ] Replace any in-memory token bucket with `RateLimiterRedis` from `rate-limiter-flexible`
- [ ] Accept an optional Redis client in the factory function; fall back to `RateLimiterMemory` if the client is not connected
- [ ] Keep the public API (`consume(key: string): Promise<void>`) identical so no call sites change

Run tests — confirm **pass** (green).

### 4.3 Verify existing call sites still compile

```bash
pnpm tsc --noEmit --filter orchestrator
pnpm test --filter orchestrator
```

```bash
git add apps/orchestrator/src/rateLimiter.ts apps/orchestrator/src/__tests__/rateLimiter.test.ts
git commit -m "feat(v6.1): migrate rate limiter to Redis backend with in-memory fallback"
```

---

## Step 5 — Redis-backed availability cache (`availability.ts`)

### 5.1 Write the tests first

Create `apps/orchestrator/src/__tests__/availability.test.ts`:

- [ ] **Test: `setAvailability()` stores a value retrievable by `getAvailability()`**
  - Call `setAvailability("police-api", { months: ["2024-01"] })`
  - Call `getAvailability("police-api")`
  - Expect the returned value to deeply equal what was stored

- [ ] **Test: `getAvailability()` returns `null` for an unknown key**
  - Call `getAvailability("nonexistent-source")`
  - Expect `null`

- [ ] **Test: stored values expire after the configured TTL**
  - Set a very short TTL (e.g. 1 second) via config
  - Store a value
  - Wait for TTL to elapse (`await sleep(1100)`)
  - Call `getAvailability()`
  - Expect `null`

- [ ] **Test: two separate instances share availability state via Redis**
  - Write via instance A
  - Read via instance B (same Redis, same key prefix)
  - Expect the read to succeed — confirming cross-instance consistency

- [ ] **Test: falls back to in-memory behaviour when Redis is unavailable**
  - Initialise the availability cache with a disconnected Redis client
  - Call `setAvailability()` then `getAvailability()`
  - Expect in-memory round-trip to work without throwing

Run tests — confirm **fail** (red).

### 5.2 Update `availability.ts`

- [ ] Replace the in-memory `Map` with Redis `SET` / `GET` using `ioredis`
- [ ] Serialise values to JSON before storage; deserialise on retrieval
- [ ] Apply a configurable TTL — read from `AVAILABILITY_CACHE_TTL_SECONDS`, default `3600`
- [ ] Accept an optional Redis client; fall back to in-memory `Map` if the client is not connected
- [ ] Keep the public API (`getAvailability`, `setAvailability`) unchanged so no call sites require changes

Run tests — confirm **pass** (green).

```bash
git add apps/orchestrator/src/availability.ts apps/orchestrator/src/__tests__/availability.test.ts
git commit -m "feat(v6.1): migrate availability cache to Redis with TTL and in-memory fallback"
```

---

## Step 6 — Redis health check in the startup sequence

### 6.1 Write the tests first

Create or extend `apps/orchestrator/src/__tests__/startup.test.ts`:

- [ ] **Test: startup logs a warning (not an error) when Redis is unreachable**
  - Spy on your logger's `warn` method
  - Call the startup initialisation function with a disconnected Redis client
  - Expect `warn` to have been called with a message referencing Redis
  - Expect the function to resolve without throwing

- [ ] **Test: startup does not call `process.exit` when Redis is unreachable**
  - Spy on `process.exit`
  - Call startup with a disconnected client
  - Expect `process.exit` not to have been called

- [ ] **Test: startup logs no Redis warning when Redis is healthy**
  - Spy on `console.warn`
  - Call startup with a connected client
  - Expect no Redis-related warning to have been emitted

Run tests — confirm **fail** (red).

### 6.2 Add the health check to startup

In `apps/orchestrator/src/server.ts` (or your bootstrap entry point):

- [ ] Call `checkRedisHealth()` during startup
- [ ] If it returns `false`, log a warning: `"Redis unavailable — falling back to in-memory mode for rate limiter and availability cache"`
- [ ] Do not throw, do not call `process.exit` — the app continues in degraded mode

Run tests — confirm **pass** (green).

```bash
git add apps/orchestrator/src/server.ts apps/orchestrator/src/__tests__/startup.test.ts
git commit -m "feat(v6.1): add Redis health check to startup with graceful fallback warning"
```

---

## Step 7 — Environment variable documentation

- [ ] Open `.env.example` at the repo root (create it if it does not exist)
- [ ] Add the following entries:

```bash
# Redis connection string — required for shared rate limiting and availability cache
# across multiple orchestrator instances. If unset or unreachable, the orchestrator
# falls back to in-memory mode (safe for single-instance local development).
REDIS_URL=redis://localhost:6379

# TTL in seconds for availability cache entries (default: 3600)
AVAILABILITY_CACHE_TTL_SECONDS=3600
```

- [ ] Confirm `REDIS_URL` is in `.env.example` but not in `.env` if it contains credentials

```bash
git add .env.example
git commit -m "docs(v6.1): document REDIS_URL and AVAILABILITY_CACHE_TTL_SECONDS in .env.example"
```

---

## Step 8 — Integration smoke tests

These tests run against a live Redis instance and confirm end-to-end behaviour across simulated separate processes. Tag them (e.g. `@integration`) so they can be excluded from fast unit CI runs.

Create `apps/orchestrator/src/__tests__/redis.integration.test.ts`:

- [ ] **Test: rate limiter state is shared across two orchestrator instances**
  - Create two in-process orchestrator instances both connected to the test Redis
  - Exhaust the rate limit via instance A for a given key
  - Fire a request via instance B using the same key
  - Expect instance B to be rate-limited

- [ ] **Test: availability cache survives a simulated restart**
  - Write an availability entry via instance A
  - Destroy instance A — close the client, lose all in-memory state
  - Create a fresh instance B connected to the same Redis
  - Read the availability entry via instance B
  - Expect the value to be present and correct

- [ ] **Test: orchestrator starts and serves requests when Redis is down**
  - Point `REDIS_URL` at a port with nothing listening
  - Send a valid query request to the orchestrator
  - Expect a `200` response (in-memory fallback is active)
  - Expect the startup log to contain the Redis unavailability warning

```bash
git add apps/orchestrator/src/__tests__/redis.integration.test.ts
git commit -m "test(v6.1): add integration smoke tests for Redis-backed rate limiter and availability cache"
```

---

## Step 9 — Full test run and cleanup

- [ ] Run the complete test suite

```bash
pnpm test
```

- [ ] Run TypeScript compilation check across all packages

```bash
pnpm tsc --noEmit
```

- [ ] Review test coverage for `redis.ts`, `rateLimiter.ts`, and `availability.ts` — aim for 100% branch coverage on the fallback paths
- [ ] Remove any `console.log` debug statements added during development
- [ ] Confirm `.env.example` is committed and up to date

```bash
git add -A
git commit -m "chore(v6.1): cleanup — remove debug logs, confirm coverage on fallback paths"
```

---

## Step 10 — PR and merge

- [ ] Push the branch

```bash
git push -u origin feat/v6.1-redis-stabilisation
```

- [ ] Open a pull request with the following checklist in the description:
  - [ ] `redis.ts` singleton client with health check
  - [ ] `rateLimiter.ts` migrated to `RateLimiterRedis` with `RateLimiterMemory` fallback
  - [ ] `availability.ts` migrated to Redis `SET`/`GET` with TTL and in-memory fallback
  - [ ] Startup logs a warning (not an error) when Redis is unreachable
  - [ ] `.env.example` documents `REDIS_URL` and `AVAILABILITY_CACHE_TTL_SECONDS`
  - [ ] All unit tests pass
  - [ ] Integration smoke tests pass against a live Redis instance
  - [ ] No breaking changes to the public APIs of `rateLimiter.ts` or `availability.ts`

- [ ] After review and approval, merge to `main`

```bash
git checkout main
git pull
git branch -d feat/v6.1-redis-stabilisation
```

---

## Commit summary

| # | Message |
|---|---|
| 1 | `chore(v6.1): install ioredis and rate-limiter-flexible` |
| 2 | `feat(v6.1): add shared Redis client with health check (redis.ts)` |
| 3 | `feat(v6.1): migrate rate limiter to Redis backend with in-memory fallback` |
| 4 | `feat(v6.1): migrate availability cache to Redis with TTL and in-memory fallback` |
| 5 | `feat(v6.1): add Redis health check to startup with graceful fallback warning` |
| 6 | `docs(v6.1): document REDIS_URL and AVAILABILITY_CACHE_TTL_SECONDS in .env.example` |
| 7 | `test(v6.1): add integration smoke tests for Redis-backed rate limiter and availability cache` |
| 8 | `chore(v6.1): cleanup — remove debug logs, confirm coverage on fallback paths` |
