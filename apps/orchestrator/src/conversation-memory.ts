/**
 * conversation-memory.ts — Phase C.8
 *
 * Redis-backed store for QueryContext and UserProfile.
 *
 * Key layout:
 *   session:context:{sessionId}           — QueryContext JSON, TTL 24h
 *   session:handles:{sessionId}           — Hash: handleId → ResultHandle JSON, TTL 24h
 *   user:profile:{userId}                 — UserProfile JSON, TTL 30d (refreshed on read)
 *
 * Size limits (enforced on every write, non-fatal — oversized keys are dropped
 * with a warning rather than rejecting the write):
 *   active_filters   — max 20 KV pairs; keys ≤ 64 chars, values ≤ 2 000 chars
 *   result_stack     — max RESULT_STACK_MAX handles
 *   context total    — max 64 KB
 *   user_attributes  — max 50 KV pairs; keys ≤ 64 chars, values ≤ 2 000 chars
 *   location_history — max 10 entries
 *   profile total    — max 32 KB
 *
 * All functions are non-throwing — Redis errors return null / no-op silently.
 */

import { randomUUID } from "crypto";
import { getRedisClient } from "./redis";
import { inferCapabilities } from "./capability-inference";
import type {
  ConversationMemory,
  QueryContext,
  ResultHandle,
  UserProfile,
} from "./types/connected";
import {
  EPHEMERAL_TTL_SECONDS,
  MAX_EPHEMERAL_ROWS,
  RESULT_STACK_MAX,
  SESSION_TTL_SECONDS,
  USER_PROFILE_TTL_SECONDS,
} from "./types/connected";

// ── Size limits ───────────────────────────────────────────────────────────────

const MAX_ACTIVE_FILTERS      = 20;
const MAX_FILTER_KEY_LEN      = 64;
const MAX_FILTER_VALUE_LEN    = 2_000;
const MAX_CONTEXT_BYTES       = 64 * 1024;   // 64 KB

const MAX_USER_ATTRIBUTES     = 50;
const MAX_ATTR_KEY_LEN        = 64;
const MAX_ATTR_VALUE_LEN      = 2_000;
const MAX_LOCATION_HISTORY    = 10;
const MAX_PROFILE_BYTES       = 32 * 1024;   // 32 KB

// ── Key builders ──────────────────────────────────────────────────────────────

const ctxKey     = (sid: string) => `session:context:${sid}`;
const handlesKey = (sid: string) => `session:handles:${sid}`;
const profileKey = (uid: string) => `user:profile:${uid}`;

// ── Sanitisers ────────────────────────────────────────────────────────────────

function sanitiseFilters(
  filters: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(filters)) {
    if (count >= MAX_ACTIVE_FILTERS) {
      console.warn(JSON.stringify({ event: "context_filters_truncated", key: k }));
      break;
    }
    const ks = String(k).slice(0, MAX_FILTER_KEY_LEN);
    const vs = String(v).slice(0, MAX_FILTER_VALUE_LEN);
    out[ks] = vs;
    count++;
  }
  return out;
}

function sanitiseAttributes(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(attrs)) {
    if (count >= MAX_USER_ATTRIBUTES) {
      console.warn(JSON.stringify({ event: "profile_attrs_truncated", key: k }));
      break;
    }
    const ks = String(k).slice(0, MAX_ATTR_KEY_LEN);
    const vs = String(v).slice(0, MAX_ATTR_VALUE_LEN);
    out[ks] = vs;
    count++;
  }
  return out;
}

function sanitiseContext(ctx: QueryContext): QueryContext {
  return {
    ...ctx,
    active_filters: sanitiseFilters(ctx.active_filters),
    result_stack: ctx.result_stack.slice(0, RESULT_STACK_MAX),
  };
}

function sanitiseProfile(profile: UserProfile): UserProfile {
  return {
    user_attributes: sanitiseAttributes(profile.user_attributes),
    location_history: profile.location_history.slice(0, MAX_LOCATION_HISTORY),
  };
}

function checkSize(serialised: string, limit: number, label: string): boolean {
  const bytes = Buffer.byteLength(serialised, "utf8");
  if (bytes > limit) {
    console.warn(
      JSON.stringify({ event: "memory_size_limit", label, bytes, limit }),
    );
    return false;
  }
  return true;
}

// ── QueryContext ──────────────────────────────────────────────────────────────

export async function getQueryContext(
  sessionId: string,
): Promise<QueryContext | null> {
  try {
    const raw = await getRedisClient().get(ctxKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as QueryContext;
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_read_error",
      key: "QueryContext",
      error: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

export async function setQueryContext(
  sessionId: string,
  context: QueryContext,
): Promise<void> {
  try {
    const clean = sanitiseContext(context);
    const serialised = JSON.stringify(clean);
    if (!checkSize(serialised, MAX_CONTEXT_BYTES, "QueryContext")) {
      console.error(JSON.stringify({
        event: "session_payload_too_large",
        key: "QueryContext",
        bytes: Buffer.byteLength(serialised, "utf8"),
        limit: MAX_CONTEXT_BYTES,
      }));
      return;
    }
    await getRedisClient().set(ctxKey(sessionId), serialised, "EX", SESSION_TTL_SECONDS);
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_write_error",
      key: "QueryContext",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

/** Merge a partial update into the stored QueryContext (read-modify-write). */
export async function updateQueryContext(
  sessionId: string,
  update: Partial<QueryContext>,
): Promise<void> {
  const existing = (await getQueryContext(sessionId)) ?? emptyContext();
  await setQueryContext(sessionId, { ...existing, ...update });
}

export function emptyContext(): QueryContext {
  return {
    location: null,
    active_plan: null,
    result_stack: [],
    active_filters: {},
  };
}

// ── ResultHandle storage (per-session hash) ───────────────────────────────────

/**
 * Store a ResultHandle in the session handles hash.
 * Ephemeral handles only — persistent handles are referenced by id only.
 */
export async function storeResultHandle(
  sessionId: string,
  handle: ResultHandle,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.hset(handlesKey(sessionId), handle.id, JSON.stringify(handle));
    await redis.expire(handlesKey(sessionId), SESSION_TTL_SECONDS);
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_write_error",
      key: "ResultHandle",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

export async function getResultHandle(
  sessionId: string,
  handleId: string,
): Promise<ResultHandle | null> {
  try {
    const raw = await getRedisClient().hget(handlesKey(sessionId), handleId);
    if (!raw) return null;
    return JSON.parse(raw) as ResultHandle;
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_read_error",
      key: "ResultHandle",
      error: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

/** Delete a single handle from the hash (called on eviction). */
export async function deleteResultHandle(
  sessionId: string,
  handleId: string,
): Promise<void> {
  try {
    await getRedisClient().hdel(handlesKey(sessionId), handleId);
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_write_error",
      key: "ResultHandle.delete",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

/** Delete all handles for a session (single DEL — no SCAN). */
export async function clearResultHandles(sessionId: string): Promise<void> {
  try {
    await getRedisClient().del(handlesKey(sessionId));
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_write_error",
      key: "ResultHandles.clear",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

// ── UserProfile ───────────────────────────────────────────────────────────────

export async function getUserProfile(
  userId: string,
): Promise<UserProfile | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(profileKey(userId));
    if (!raw) return null;
    // Refresh TTL on every read
    await redis.expire(profileKey(userId), USER_PROFILE_TTL_SECONDS);
    return JSON.parse(raw) as UserProfile;
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_read_error",
      key: "UserProfile",
      error: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

export async function setUserProfile(
  userId: string,
  profile: UserProfile,
): Promise<void> {
  try {
    const clean = sanitiseProfile(profile);
    const serialised = JSON.stringify(clean);
    if (!checkSize(serialised, MAX_PROFILE_BYTES, "UserProfile")) {
      console.error(JSON.stringify({
        event: "session_payload_too_large",
        key: "UserProfile",
        bytes: Buffer.byteLength(serialised, "utf8"),
        limit: MAX_PROFILE_BYTES,
      }));
      return;
    }
    await getRedisClient().set(
      profileKey(userId),
      serialised,
      "EX",
      USER_PROFILE_TTL_SECONDS,
    );
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_write_error",
      key: "UserProfile",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

export function emptyProfile(): UserProfile {
  return { user_attributes: {}, location_history: [] };
}

// ── ConversationMemory (composed view) ────────────────────────────────────────

/**
 * Load QueryContext + UserProfile for a session.
 * Returns empty defaults when either key is absent.
 */
export async function loadMemory(
  sessionId: string,
  userId?: string,
): Promise<ConversationMemory> {
  const [context, profile] = await Promise.all([
    getQueryContext(sessionId),
    userId ? getUserProfile(userId) : Promise.resolve(null),
  ]);
  return {
    context: context ?? emptyContext(),
    profile: profile ?? emptyProfile(),
  };
}

// ── Ephemeral ResultHandle — Phase C.9 ───────────────────────────────────────

/**
 * Create an ephemeral ResultHandle from raw rows.
 *
 * - Caps data at MAX_EPHEMERAL_ROWS (100).
 * - Infers capabilities from the rows.
 * - If a source returns more than MAX_EPHEMERAL_ROWS rows the adapter MUST
 *   store results persistently instead; this function logs a warning in that case.
 */
export function createEphemeralHandle(
  rows: unknown[],
  domain: string,
): ResultHandle {
  if (rows.length > MAX_EPHEMERAL_ROWS) {
    console.warn(
      JSON.stringify({
        event: "ephemeral_rows_capped",
        domain,
        received: rows.length,
        cap: MAX_EPHEMERAL_ROWS,
      }),
    );
  }
  const capped = rows.slice(0, MAX_EPHEMERAL_ROWS);
  return {
    id:           `ephemeral_${randomUUID()}`,
    type:         domain,
    domain,
    capabilities: inferCapabilities(capped),
    ephemeral:    true,
    rowCount:     capped.length,
    data:         capped,
  };
}

/**
 * Push a ResultHandle onto the session's result_stack (newest first).
 *
 * - If the stack already has RESULT_STACK_MAX entries the oldest handle is
 *   evicted: removed from the stack AND its Redis hash entry is deleted
 *   immediately (no waiting for TTL expiry).
 * - For ephemeral handles the full handle (with data) is written to the
 *   session handles hash with EPHEMERAL_TTL_SECONDS TTL.
 * - Persists the updated QueryContext.
 */
export async function pushResultHandle(
  sessionId: string,
  handle: ResultHandle,
): Promise<void> {
  try {
    const ctx = (await getQueryContext(sessionId)) ?? emptyContext();

    // Evict oldest if at capacity
    let stack = [handle, ...ctx.result_stack];
    if (stack.length > RESULT_STACK_MAX) {
      const evicted = stack.splice(RESULT_STACK_MAX); // remove tail
      for (const old of evicted) {
        if (old.ephemeral) {
          await deleteResultHandle(sessionId, old.id);
        }
      }
    }

    // Store handle data in Redis hash (ephemeral only)
    if (handle.ephemeral) {
      const redis = getRedisClient();
      await redis.hset(
        handlesKey(sessionId),
        handle.id,
        JSON.stringify(handle),
      );
      await redis.expire(handlesKey(sessionId), EPHEMERAL_TTL_SECONDS);
    }

    // Persist updated context (strip data from stack entries to keep context small)
    const stackMeta = stack.map((h) => ({ ...h, data: null }));
    await setQueryContext(sessionId, { ...ctx, result_stack: stackMeta });
  } catch (err) {
    console.warn(JSON.stringify({
      event: "redis_write_error",
      key: "pushResultHandle",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}
