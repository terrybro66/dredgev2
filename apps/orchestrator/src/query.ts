import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  QueryPlanSchema,
  ResultContext,
  FallbackInfo,
  VizHintSchema,
  DomainConfigV2,
  VizHint,
} from "@dredge/schemas";
import { prisma } from "./db";
import { geocodeToPolygon } from "./geocoder";
import { parseIntent, deriveVizHint, expandDateRange } from "./intent";
import { getDomainForQuery, getDomainByName, getAllAdapters, DomainAdapter } from "./domains/registry";
import { acquire } from "./rateLimiter";
import { AggregatedBin } from "@dredge/schemas";
import { domainDiscovery } from "./agent/domain-discovery";
import { createSnapshot } from "./execution-model";
import { classifyIntent } from "./semantic/classifier";
import { findCuratedSource, SearchStrategy } from "./curated-registry";
import { parsePoly } from "./poly";
import { createRestProvider } from "./providers/rest-provider";
import { tagRows } from "./enrichment/source-tag";
import { suggestFollowups } from "./suggest-followups";
import { getMergedRelationships } from "./relationship-discovery";
import { buildClarificationRequest } from "./clarification";
import { getRegulatoryAdapter } from "./regulatory-adapter";
import {
  updateQueryContext,
  getQueryContext,
  getResultHandle,
  pushResultHandle,
  createEphemeralHandle,
  loadMemory,
} from "./conversation-memory";
import { recordCoOccurrence } from "./co-occurrence-log";
import {
  setUserLocation,
  getUserLocation,
  recordChipClick,
  getChipClickCounts,
} from "./session";
import { QueryRouter } from "./query-router";
import { getWorkflowById, findWorkflowsForIntent } from "./workflow-templates";
import { executeWorkflow } from "./workflow-executor";
import { generateInsight, synthesiseStack } from "./insight";
import { CATEGORY_TO_INTENT, normalizeToDomainSlug } from "./domain-slug";
import { defaultResolveTemporalRange } from "./temporal-resolver";

// ── DomainConfigV2 helpers ────────────────────────────────────────────────────

/** Derive the effective viz hint from DomainConfigV2 visualisation config. */
function getVizHint(config: DomainConfigV2, months: string[]): VizHint {
  if (months.length > 1) {
    const multiRule = config.visualisation.rules.find(
      (r) => r.condition === "multi_month",
    );
    if (multiRule) return multiRule.view;
  }
  return config.visualisation.default;
}

/** Get canonical source URL for snapshot recording. */
function getSourceUrl(config: DomainConfigV2): string {
  if (config.source.type === "overpass")
    return "https://overpass-api.de/api/interpreter";
  return (config.source as { endpoint: string }).endpoint ?? "";
}

// ── B2: Data freshness + source attribution helpers ───────────────────────────

/**
 * Derive the most recent date string from result rows.
 * Returns "YYYY-MM" formatted as "Month YYYY" (e.g. "March 2025"), or null.
 */
function deriveDataFreshness(rows: Record<string, unknown>[]): string | null {
  if (rows.length === 0) return null;
  let latest: string | null = null;
  for (const row of rows) {
    const d =
      row["date"] ?? row["month"] ?? row["ratingDate"] ?? row["created_at"];
    if (typeof d === "string" && d.length >= 7) {
      const candidate = d.slice(0, 7); // YYYY-MM
      if (!latest || candidate > latest) latest = candidate;
    }
  }
  if (!latest) return null;
  const [year, month] = latest.split("-");
  const monthName = new Date(`${year}-${month}-01`).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
  return monthName;
}

// ── B3: Empty state reason ────────────────────────────────────────────────────

/**
 * Classify why a query returned 0 rows so the frontend can show
 * a meaningful message rather than a blank panel.
 */
function deriveEmptyReason(
  plan: {
    date_from?: string;
    date_to?: string;
    category?: string;
    location?: string;
  },
  months: string[],
): { code: string; message: string; suggestion: string } {
  if (months.length === 0) {
    return {
      code: "no_data_for_area",
      message: `No data available for this area.`,
      suggestion: `Try a nearby city or a different location.`,
    };
  }

  return {
    code: "no_results",
    message: `No ${plan.category ?? "results"} found for this area and time period.`,
    suggestion: `Try broadening your search — a larger area or different date range.`,
  };
}

// ── Co-occurrence recording helper — D.13 ────────────────────────────────────
//
// Fire-and-forget — never throws, never blocks a response.
// Call after every successful domain fetch so the learning system accumulates
// real co-occurrence signal from user sessions.

async function recordDomainCoOccurrence(
  sessionId: string | null,
  currentDomain: string,
): Promise<void> {
  if (!sessionId) return;
  try {
    const ctx = await getQueryContext(sessionId);
    const priorDomains = (ctx?.result_stack ?? [])
      .map((h) => h.domain)
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .slice(0, 3);

    if (priorDomains.length > 0) {
      await recordCoOccurrence([currentDomain, ...priorDomains]);
    }

    // Push a lightweight marker so subsequent queries can see this domain
    const handle = createEphemeralHandle([], currentDomain);
    await pushResultHandle(sessionId, handle);
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "co_occurrence_failed",
        domain: currentDomain,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export const queryRouter = Router();

const ParseBodySchema = z.object({ text: z.string().min(1) });

const ExecuteBodySchema = z.object({
  plan: QueryPlanSchema,
  poly: z.string().default(""),
  viz_hint: VizHintSchema,
  resolved_location: z.string(),
  country_code: z.string(),
  intent: z.string().default("unknown"),
  months: z.array(z.string()),
  rawText: z.string().optional(),
  // D.6 — user attributes collected via ClarificationRequest answers
  user_attributes: z.record(z.unknown()).optional(),
});

// ── POST /parse ───────────────────────────────────────────────────────────────

queryRouter.post("/parse", async (req: Request, res: Response) => {
  const bodyResult = ParseBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: bodyResult.error.errors });
  }
  const { text } = bodyResult.data;

  let plan;
  try {
    plan = await parseIntent(text);
  } catch (err: any) {
    return res.status(400).json(err);
  }

  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? null;

  // Detect "near me" — if the LLM returned a near-me placeholder, substitute
  // the location stored from the user's last real query.
  const NEAR_ME_PATTERN =
    /\bnear\s+me\b|\bmy\s+location\b|\bmy\s+area\b|\bnearby\b/i;
  if (NEAR_ME_PATTERN.test(plan.location) || NEAR_ME_PATTERN.test(text)) {
    if (sessionId) {
      const stored = await getUserLocation(sessionId);
      if (stored) {
        plan = {
          ...plan,
          location: stored.display_name,
        };
      }
    }
  }

  let geocoded;
  try {
    geocoded = await geocodeToPolygon(plan.location, prisma);
  } catch (err: any) {
    return res.status(400).json(err);
  }

  // Store resolved location for future "near me" queries
  if (sessionId && !NEAR_ME_PATTERN.test(text)) {
    await setUserLocation(sessionId, {
      lat: geocoded.lat,
      lon: geocoded.lon,
      display_name: geocoded.display_name,
      country_code: geocoded.country_code,
    });
  }

  let intent: string | undefined;

  if (classifyIntent !== null) {
    try {
      const classified = await classifyIntent(text, prisma);
      if (classified.confidence >= 0.5 && classified.domain) {
        intent = classified.intent;
        console.log(
          JSON.stringify({
            event: "semantic_intent_classified",
            intent,
            domain: classified.domain,
            confidence: classified.confidence,
          }),
        );
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "semantic_classifier_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // Resolve temporal expression to concrete date range.
  // Route through the matched adapter's resolveTemporalRange if it has one —
  // this lets domains like crime-uk anchor relative expressions ("last month")
  // to their own availability cache without domain names appearing here.
  const unresolvedTemporal = (plan as any).temporal as string;
  const temporalRoutingIntent = CATEGORY_TO_INTENT[intent ?? ""] ?? intent;
  const temporalAdapter = temporalRoutingIntent
    ? getDomainForQuery(geocoded.country_code, temporalRoutingIntent)
    : undefined;
  const dateRange: { date_from: string; date_to: string } =
    temporalAdapter?.resolveTemporalRange
      ? await temporalAdapter.resolveTemporalRange(unresolvedTemporal)
      : defaultResolveTemporalRange(unresolvedTemporal);

  const resolvedPlan = {
    category: plan.category,
    location: plan.location,
    date_from: dateRange.date_from,
    date_to: dateRange.date_to,
  };

  const viz_hint = deriveVizHint(resolvedPlan, text, intent ?? "unknown");
  const months = expandDateRange(resolvedPlan.date_from, resolvedPlan.date_to);

  const suggestedWorkflows = findWorkflowsForIntent(text);
  const suggested_workflow =
    suggestedWorkflows.length > 0
      ? {
          workflow_id: suggestedWorkflows[0].id,
          workflow_name: suggestedWorkflows[0].name,
          description: suggestedWorkflows[0].description,
          input_schema: suggestedWorkflows[0].input_schema,
        }
      : undefined;
  return res.json({
    plan: resolvedPlan,
    temporal: unresolvedTemporal,
    poly: geocoded.poly,
    viz_hint,
    resolved_location: geocoded.display_name,
    country_code: geocoded.country_code,
    intent,
    months,
    ...(suggested_workflow ? { suggested_workflow } : {}),
  });
});

// ── POST /execute ─────────────────────────────────────────────────────────────

queryRouter.post("/execute", async (req: Request, res: Response) => {
  const bodyResult = ExecuteBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: bodyResult.error.errors });
  }

  const {
    poly,
    resolved_location,
    country_code,
    intent,
    months,
    rawText,
    user_attributes,
  } = bodyResult.data;
  let plan = bodyResult.data.plan;
  let viz_hint = bodyResult.data.viz_hint;

  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? null;
  const userAttributes = user_attributes ?? {};
  const clarificationText = rawText ?? intent ?? plan.category ?? "";

  // Load session memory once — used for Tier 2 refinement (C.1) and chip
  // ranking (C.4/C.8). Non-blocking guard: only when sessionId is present.
  const memory = sessionId ? await loadMemory(sessionId) : null;
  const clickCounts = sessionId ? await getChipClickCounts(sessionId) : {};

  // C.1 — Tier 2 refinement: domain-match guard
  //
  // Only apply refinement when the incoming query is in the same domain as the
  // active plan. Without this guard, "flood risk in York" after "crime in
  // Manchester" triggers location_shift and produces a corrupted crime plan.
  //
  // Guard logic:
  //   1. Normalise both the incoming intent and the active plan's category to a
  //      canonical domain slug via CATEGORY_TO_INTENT.
  //   2. If slugs differ → skip refinement, clear active_plan (cross-domain fresh start).
  //   3. If slugs match → run QueryRouter; apply mergedPlan on refinement result.
  //   4. On fresh_query with clearActivePlan → clear active_plan in session.
  if (rawText && memory) {
    const activePlan = memory.context.active_plan;
    if (activePlan) {
      const incomingSlug = normalizeToDomainSlug(intent, plan.category);
      const activeSlug = normalizeToDomainSlug(undefined, activePlan.category);

      if (incomingSlug === activeSlug) {
        const router = new QueryRouter();
        const routeResult = await router.route(rawText, memory, prisma);
        if (routeResult.type === "refinement") {
          plan = routeResult.mergedPlan;
          console.log(
            JSON.stringify({
              event: "refinement_applied",
              rawText,
              incomingSlug,
            }),
          );
        } else if (
          routeResult.type === "fresh_query" &&
          routeResult.clearActivePlan &&
          sessionId
        ) {
          updateQueryContext(sessionId, { active_plan: null }).catch(() => {});
        }
      } else {
        // Cross-domain query — clear stale active_plan so it doesn't bleed
        // into subsequent refinements.
        console.log(
          JSON.stringify({
            event: "refinement_skipped_cross_domain",
            incoming: incomingSlug,
            active: activeSlug,
          }),
        );
        if (sessionId) {
          updateQueryContext(sessionId, { active_plan: null }).catch(() => {});
        }
      }
    }
  }

  // 0. Clarification check — regulatory/eligibility intents return questions
  //    before any data fetch. Only run when the user has not yet answered;
  //    once user_attributes are populated we skip straight to evaluation.
  if (Object.keys(userAttributes).length === 0) {
    const clarificationRequest = buildClarificationRequest(clarificationText);
    if (clarificationRequest) {
      return res.status(200).json({
        type: "clarification",
        request: clarificationRequest,
      });
    }
  }

  // 0b. Regulatory adapter check — when user_attributes are present evaluate
  //     eligibility and return a decision_result without fetching any data.
  const regulatoryAdapter = getRegulatoryAdapter(
    clarificationText,
    country_code,
  );
  if (regulatoryAdapter && Object.keys(userAttributes).length > 0) {
    const decision = await regulatoryAdapter.evaluate(userAttributes);

    // D.6 — persist answered attributes to session context
    if (sessionId) {
      await updateQueryContext(sessionId, {
        active_filters: { ...userAttributes },
      });
    }

    return res.status(200).json({
      type: "decision_result",
      decision,
      intent: clarificationText,
    });
  }

  // 1. Resolve adapter via intent + country routing
  // Use classified intent, fall back to plan.category before giving up.
  const resolvedIntent =
    intent && intent !== "unknown"
      ? intent
      : plan.category && plan.category !== "unknown"
        ? plan.category
        : undefined;

  // Map crime subcategories to the registered intent slug.
  // The LLM returns "burglary" as category but the registry uses "crime".
  // Similarly, LLM variants of other intents are normalised here.
  // (Map is defined in domain-slug.ts and imported at module scope.)
  const routingIntent =
    CATEGORY_TO_INTENT[resolvedIntent ?? ""] ?? resolvedIntent;

  let adapter: DomainAdapter | undefined = routingIntent
    ? getDomainForQuery(country_code, routingIntent)
    : undefined;

  if (!adapter) {
    // 1b. Check curated registry before falling through to discovery
    const curatedSource = routingIntent
      ? findCuratedSource(routingIntent, country_code)
      : null;

    if (curatedSource) {
      // Curated registry matched — do NOT run discovery. The curated entry is the
      // authoritative source for this intent. Discovery would find the same URLs
      // (wasted API calls) or garbage URLs (scrape-type), and could create
      // duplicate DomainDiscovery records for an intent we already handle.

      // Build an on-the-fly adapter from the curated source
      const source = curatedSource; // capture for closures
      const curatedConfig: DomainConfigV2 = {
        identity: {
          name: source.name,
          displayName: source.name,
          description: source.name,
          countries: source.countryCodes,
          intents: [source.intent],
        },
        source: { type: "rest", endpoint: source.url },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: {
          storeResults: source.storeResults,
          tableName: "query_results",
          prismaModel: "queryResult",
          extrasStrategy: "retain_unmapped",
        },
        visualisation: { default: "table", rules: [] },
      };
      adapter = {
        config: curatedConfig,

        async fetchData(
          _plan: unknown,
          _locationArg: string,
        ): Promise<unknown[]> {
          try {
            if (source.type === "scrape") {
              const { createScrapeProvider } =
                await import("./providers/scrape-provider");
              const { resolveUrlForQuery } =
                await import("./agent/search/serp");

              let fetchUrl = source.url ?? "";
              let extractionPrompt = source.extractionPrompt ?? "";

              if ((source as any).searchStrategy) {
                const strategy = (source as any)
                  .searchStrategy as SearchStrategy;
                const { getCachedScrapeUrl, setCachedScrapeUrl } =
                  await import("./agent/search/scrape-url-cache");
                const { generateExtractionPrompt } =
                  await import("./agent/search/extraction-prompt-generator");

                // Use resolved_location when available; fall back to country
                // name so bare queries ("cinema listings") don't return US results
                const COUNTRY_NAMES: Record<string, string> = {
                  GB: "UK",
                  US: "USA",
                  AU: "Australia",
                  CA: "Canada",
                  IE: "Ireland",
                };
                const locationContext =
                  resolved_location && resolved_location.trim()
                    ? resolved_location
                    : (COUNTRY_NAMES[country_code] ?? country_code);

                // Check cache first — saves a SerpAPI call on repeat queries
                const cached = await getCachedScrapeUrl(
                  source.intent,
                  locationContext,
                );

                if (cached) {
                  console.log(
                    JSON.stringify({
                      event: "scrape_url_cache_hit",
                      url: cached.url,
                      intent: source.intent,
                      location: locationContext,
                    }),
                  );
                  fetchUrl = cached.url;
                  extractionPrompt = cached.extractionPrompt;
                } else {
                  const serpQuery = strategy.queryTemplate
                    .replace("{intent}", source.intent)
                    .replace("{location}", locationContext);

                  console.log(
                    JSON.stringify({
                      event: "scrape_url_resolving",
                      query: serpQuery,
                    }),
                  );
                  fetchUrl =
                    (await resolveUrlForQuery(
                      serpQuery,
                      strategy.preferredDomains ?? [],
                    )) ?? "";

                  if (!fetchUrl) {
                    console.warn(
                      JSON.stringify({
                        event: "scrape_url_not_found",
                        query: serpQuery,
                      }),
                    );
                    return [];
                  }

                  console.log(
                    JSON.stringify({
                      event: "scrape_url_resolved",
                      url: fetchUrl,
                    }),
                  );

                  // Generate extraction prompt if not curated
                  if (!extractionPrompt) {
                    extractionPrompt = await generateExtractionPrompt(
                      source.intent,
                    );
                    console.log(
                      JSON.stringify({
                        event: "scrape_prompt_generated",
                        intent: source.intent,
                      }),
                    );
                  }

                  // Populate cache for next time
                  await setCachedScrapeUrl(source.intent, locationContext, {
                    url: fetchUrl,
                    extractionPrompt,
                  });
                }
              }
              // Fallback: generate prompt for static-URL scrape sources
              // that have no curated extractionPrompt and no searchStrategy
              if (!extractionPrompt) {
                const { generateExtractionPrompt } =
                  await import("./agent/search/extraction-prompt-generator");
                extractionPrompt = await generateExtractionPrompt(
                  source.intent,
                );
                console.log(
                  JSON.stringify({
                    event: "scrape_prompt_generated_static",
                    intent: source.intent,
                  }),
                );
              }

              const provider = createScrapeProvider({ extractionPrompt });
              return tagRows(
                (await provider.fetchRows(fetchUrl)) as Record<
                  string,
                  unknown
                >[],
                fetchUrl,
              );
            }

            let restUrl = source.url ?? "";
            if (source.locationParams && poly) {
              const { lat, lon } = parsePoly(poly).centroid();
              const params = new URLSearchParams();
              params.set(source.locationParams.latParam, String(lat));
              params.set(source.locationParams.lonParam, String(lon));
              if (
                source.locationParams.radiusParam &&
                source.locationParams.radiusKm
              ) {
                params.set(
                  source.locationParams.radiusParam,
                  String(source.locationParams.radiusKm),
                );
              }
              restUrl = `${restUrl}?${params.toString()}`;
            }
            const provider = createRestProvider({ url: restUrl });
            const rows = await provider.fetchRows();
            return tagRows(rows as Record<string, unknown>[], restUrl);
          } catch (err) {
            console.warn(
              JSON.stringify({
                event: "discovery_adapter_fetch_failed",
                source: source.intent,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            return [];
          }
        },

        flattenRow(row: unknown): Record<string, unknown> {
          return row as Record<string, unknown>;
        },

        async storeResults(
          queryId: string,
          rows: unknown[],
          prismaClient: any,
        ): Promise<void> {
          if (!source.storeResults || rows.length === 0) return;
          await prismaClient.queryResult.createMany({
            data: (rows as Record<string, unknown>[]).map((row) => ({
              query_id: queryId,
              domain_name: source.name,
              source_tag:
                (row._sourceTag as string) ??
                (row.source_tag as string) ??
                source.name,
              date: row.date
                ? new Date(row.date as string)
                : row.timeRaised
                  ? new Date(row.timeRaised as string)
                  : null,
              lat: ((row.lat ?? row.latitude) as number) ?? null,
              lon: ((row.lon ?? row.longitude) as number) ?? null,
              location:
                (row.location as string) ?? (row.eaAreaName as string) ?? null,
              description: (row.description as string) ?? null,
              category:
                (row.category as string) ?? (row.severity as string) ?? null,
              value: (row.value as number) ?? null,
              raw: (row.raw as object) ?? row,
              extras: (row.extras as object) ?? null,
              snapshot_id: null,
            })),
          });
        },
      };
    } else {
      // 1c. Fall through to discovery pipeline
      if (domainDiscovery.isEnabled()) {
        const discoveryIntent =
          resolvedIntent && resolvedIntent !== "unknown"
            ? resolvedIntent
            : plan.category !== "unknown"
              ? plan.category
              : `${plan.category} in ${plan.location}`;
        // Non-blocking — don't await so the user gets a fast response
        domainDiscovery
          .run({ intent: discoveryIntent, country_code }, prisma)
          .catch((err: unknown) => {
            console.warn(
              JSON.stringify({
                event: "discovery_run_failed",
                intent: discoveryIntent,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          });
      }
      return res.status(200).json({
        error: "not_supported",
        message:
          routingIntent && routingIntent !== "unknown"
            ? `We don't have a data source for "${routingIntent}" yet. We've added it to our review queue.`
            : `We couldn't understand that query. Try asking about crime, weather, flooding, transport, cinema listings, or population statistics.`,
        supported: [
          "crime",
          "weather",
          "flood risk",
          "transport",
          "cinema listings",
          "population statistics",
        ],
        discovery_triggered: domainDiscovery.isEnabled(),
      });
    }
  }

  // 1d. Normalise plan via adapter — ensures LLM category variants ("crime
  //     statistics") map to canonical API slugs before cache hashing and fetching.
  if (adapter.normalizePlan) {
    plan = adapter.normalizePlan(plan);
  }

  // 1e. Override viz_hint from adapter's vizHintRules now that the adapter is
  //     known. The parse-time hint is a best-guess without adapter context;
  //     adapter rules are authoritative (e.g. food hygiene is always a table,
  //     hunting zones are always a map regardless of date range).
  viz_hint = getVizHint(adapter.config, months);

  // 2. Ephemeral adapters bypass cache, storage and snapshots entirely
  const isEphemeral = adapter.config.storage.storeResults === false;

  if (isEphemeral) {
    // Create job record for observability, then fetch live and return directly
    const queryRecord = await prisma.query.create({
      data: {
        text: `${plan.category} in ${plan.location}`,
        category: plan.category,
        date_from: plan.date_from,
        date_to: plan.date_to,
        poly,
        viz_hint,
        domain: adapter.config.identity.name,
        country_code,
        resolved_location,
        intent: resolvedIntent ?? null,
      },
    });
    const job = await prisma.queryJob.create({
      data: {
        query_id: queryRecord.id,
        status: "pending",
        domain: adapter.config.identity.name,
        cache_hit: false,
      },
    });
    try {
      await acquire(adapter.config);
      const rows = await adapter.fetchData(plan, poly);
      let liveResults: unknown[] = rows;
      if (viz_hint === "bar") {
        const byMonth: Record<string, number> = {};
        for (const row of rows as any[]) {
          const month = row.month ?? row.date ?? "unknown";
          byMonth[month] = (byMonth[month] ?? 0) + 1;
        }
        liveResults = Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, count]) => ({ month, count }));
      } else if (viz_hint === "table") {
        liveResults = liveResults.slice(0, 100);
      }
      await prisma.queryJob.update({
        where: { id: job.id },
        data: {
          status: "complete",
          rows_inserted: liveResults.length,
          completedAt: new Date(),
        },
      });
      return res.json({
        query_id: queryRecord.id,
        plan,
        poly,
        viz_hint,
        resolved_location,
        intent: routingIntent ?? resolvedIntent ?? null,
        count: liveResults.length,
        months_fetched: months,
        results: liveResults,
        cache_hit: false,
        ephemeral: true,
        aggregated: false,
        resultContext: {
          status: liveResults.length === 0 ? "empty" : "exact",
          followUps: [],
          confidence: liveResults.length === 0 ? "low" : "high",
        },
      });
    } catch (err: any) {
      await prisma.queryJob.update({
        where: { id: job.id },
        data: {
          status: "error",
          error_message: err.message,
          completedAt: new Date(),
        },
      });
      return res.status(500).json({ error: err.message });
    }
  }

  // 2b. Normalize plan (e.g. category slug correction) before cache hash
  if (adapter.normalizePlan) {
    plan = adapter.normalizePlan(plan);
  }

  // 2c. Clamp date_to to the current month so future dates never hit APIs
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (plan.date_to > currentMonth) {
    console.log(
      JSON.stringify({
        event: "date_clamped",
        original_date_to: plan.date_to,
        clamped_to: currentMonth,
      }),
    );
    plan = { ...plan, date_to: currentMonth };
  }
  if (plan.date_from > currentMonth) {
    plan = { ...plan, date_from: currentMonth };
  }

  // 3. Compute deterministic cache hash (persistent adapters only)
  const hashInput = JSON.stringify({
    domain: adapter.config.identity.name,
    category: plan.category,
    date_from: plan.date_from,
    date_to: plan.date_to,
    resolved_location: resolved_location.toLowerCase(),
  });
  const query_hash = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("hex");

  // Resolve merged domain relationships (static seed + Redis co-occurrence)
  // once per request so both the cache-hit and live paths use learned weights.
  const mergedRelationships = await getMergedRelationships().catch(() => []);

  let cached = await prisma.queryCache.findUnique({ where: { query_hash } });

  if (cached && adapter.config.cache?.ttlHours != null) {
    const ageHours = (Date.now() - cached.createdAt.getTime()) / 3600000;

    if (ageHours > adapter.config.cache.ttlHours) {
      await prisma.queryCache.delete({ where: { query_hash } });
      console.log(
        JSON.stringify({
          event: "cache_stale_evicted",
          domain: adapter.config.identity.name,
          query_hash,
        }),
      );
      cached = null;
    }
  }

  if (cached) {
    const queryRecord = await prisma.query.create({
      data: {
        text: `${plan.category} in ${plan.location}`,
        category: plan.category,
        date_from: plan.date_from,
        date_to: plan.date_to,
        poly,
        viz_hint,
        domain: adapter.config.identity.name,
        country_code,
        resolved_location,
        intent: resolvedIntent ?? null,
      },
    });
    await prisma.queryJob.create({
      data: {
        query_id: queryRecord.id,
        status: "complete",
        domain: adapter.config.identity.name,
        cache_hit: true,
        rows_inserted: cached.result_count,
        completedAt: new Date(),
      },
    });
    console.log(
      JSON.stringify({
        event: "execute",
        cache_hit: true,
        domain: adapter.config.identity.name,
        query_hash,
        result_count: cached.result_count,
      }),
    );

    const chips = suggestFollowups({
      rows: cached.results as unknown[],
      domain: adapter.config.identity.name,
      handleId: `qr_${queryRecord.id}`,
      ephemeral: false,
      memory: memory ?? {
        context: {
          location: null,
          active_plan: plan,
          result_stack: [],
          active_filters: {},
        },
        profile: { user_attributes: {}, location_history: [] },
      },
      clickCounts,
      domainRelationships: mergedRelationships,
      adapters: getAllAdapters(),
    });

    const cachedEmptyReason =
      cached.result_count === 0 ? deriveEmptyReason(plan, months) : null;

    const resultContext: ResultContext =
      cached.result_count === 0
        ? {
            status: "empty",
            reason: cachedEmptyReason?.message,
            followUps: [],
            confidence: "low",
          }
        : { status: "exact", followUps: [], confidence: "high" };

    const aggregated = viz_hint === "map" || viz_hint === "heatmap";

    const insight = await generateInsight(
      cached.results as Record<string, unknown>[],
      plan,
      adapter.config.identity.name,
    );

    recordDomainCoOccurrence(sessionId, adapter.config.identity.name).catch(() => {});
    if (sessionId) {
      updateQueryContext(sessionId, { active_plan: plan, active_poly: poly }).catch(() => {});
    }

    return res.json({
      query_id: queryRecord.id,
      plan,
      poly,
      viz_hint,
      resolved_location,
      intent: routingIntent ?? resolvedIntent ?? null,
      count: cached.result_count,
      months_fetched: months,
      results: cached.results,
      cache_hit: true,
      aggregated,
      chips,
      resultContext,
      source_label: adapter.config.identity.sourceLabel ?? null,
      data_freshness: deriveDataFreshness(
        cached.results as Record<string, unknown>[],
      ),
      empty_suggestion: cachedEmptyReason?.suggestion ?? null,
      insight,
    });
  }

  // 4. Live execution (cache miss)
  let queryRecord;
  try {
    queryRecord = await prisma.query.create({
      data: {
        text: `${plan.category} in ${plan.location}`,
        category: plan.category,
        date_from: plan.date_from,
        date_to: plan.date_to,
        poly,
        viz_hint,
        domain: adapter.config.identity.name,
        country_code,
        resolved_location,
        intent: resolvedIntent ?? null,
      },
    });
  } catch (err: any) {
    console.error("[execute] prisma.query.create failed:", err);
    return res.status(500).json({ error: "db_error", message: err.message });
  }

  const job = await prisma.queryJob.create({
    data: {
      query_id: queryRecord.id,
      status: "pending",
      domain: adapter.config.identity.name,
      cache_hit: false,
    },
  });

  try {
    const fetch_start = Date.now();
    await acquire(adapter.config);
    let rows = await adapter.fetchData(plan, poly);
    const fetch_ms = Date.now() - fetch_start;

    // 5. Recovery — attempt fallback strategies when fetch returned nothing
    let fallback: FallbackInfo | undefined;
    let effectiveMonths =
      adapter.config.time.type === "time_series" ? months : [];

    if (rows.length === 0 && adapter.recoverFromEmpty) {
      const recovery = await adapter.recoverFromEmpty(plan, poly, prisma);
      if (recovery) {
        rows = recovery.data;
        fallback = recovery.fallback;
        if (fallback.field === "date") {
          effectiveMonths = [fallback.used];
        }
      }
    }

    const store_start = Date.now();

    if (!isEphemeral && rows.length > 0) {
      await adapter.storeResults(queryRecord.id, rows, prisma);
    }

    const store_ms = Date.now() - store_start;

    if (!isEphemeral) {
      await createSnapshot({
        queryId: queryRecord.id,
        sourceSet: [getSourceUrl(adapter.config)],
        schemaVersion: "1.0",
        rows,
        prisma,
      });
    }

    let aggregated = false;
    let storedResults: unknown[];

    if (isEphemeral) {
      storedResults = rows;
    } else if (viz_hint === "map" || viz_hint === "heatmap") {
      if (adapter.config.template.spatialAggregation) {
        const bins = await prisma.$queryRaw<AggregatedBin[]>`
SELECT ST_Y(centroid)::float AS lat, ST_X(centroid)::float AS lon, count
FROM (
  SELECT
    ST_Centroid(ST_Collect(ST_MakePoint(lon, lat))) AS centroid,
    COUNT(*)::int AS count
  FROM query_results
  WHERE query_id = ${queryRecord.id}
    AND lat IS NOT NULL
    AND lon IS NOT NULL
  GROUP BY ST_SnapToGrid(ST_MakePoint(lon, lat), 0.002)
) grouped
`;
        storedResults = bins;
      } else {
        // Generic path — reads from query_results filtered by query_id
        storedResults = await prisma.queryResult.findMany({
          where: { query_id: queryRecord.id },
          orderBy: { created_at: "desc" },
          take: 500,
        });
      }
      aggregated = true;
    } else {
      storedResults = await (prisma as any)[
        adapter.config.storage.prismaModel
      ].findMany({
        where: { query_id: queryRecord.id },
        orderBy: (adapter.config.storage.defaultOrderBy ?? { date: "asc" }) as any,
      });
    }

    if (!isEphemeral) {
      await prisma.queryCache.create({
        data: {
          query_hash,
          domain: adapter.config.identity.name,
          result_count: storedResults.length,
          results: storedResults as any,
        },
      });
    }

    if (viz_hint === "bar") {
      const byMonth: Record<string, number> = {};
      for (const row of storedResults as any[]) {
        const month = row.month ?? (row.date ? String(row.date).slice(0, 7) : "unknown");
        byMonth[month] = (byMonth[month] ?? 0) + 1;
      }
      storedResults = Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({ month, count }));
    } else if (viz_hint === "table") {
      storedResults = storedResults.slice(0, 100);
    }

    await prisma.queryJob.update({
      where: { id: job.id },
      data: {
        status: "complete",
        rows_inserted: storedResults.length,
        fetch_ms,
        store_ms,
        completedAt: new Date(),
        fallback_applied: fallback?.field ?? null,
        fallback_success: fallback ? storedResults.length > 0 : null,
      },
    });

    console.log(
      JSON.stringify({
        event: "execute",
        cache_hit: false,
        domain: adapter.config.identity.name,
        query_hash,
        fetch_ms,
        store_ms,
        rows_inserted: storedResults.length,
        fallback_applied: fallback?.field ?? null,
      }),
    );

    const chips = suggestFollowups({
      rows: storedResults as unknown[],
      domain: adapter.config.identity.name,
      handleId: `qr_${queryRecord.id}`,
      ephemeral: false,
      memory: memory ?? {
        context: {
          location: null,
          active_plan: plan,
          result_stack: [],
          active_filters: {},
        },
        profile: { user_attributes: {}, location_history: [] },
      },
      clickCounts,
      domainRelationships: mergedRelationships,
      adapters: getAllAdapters(),
    });

    const emptyReason =
      storedResults.length === 0
        ? deriveEmptyReason(plan, effectiveMonths)
        : null;

    const resultContext: ResultContext =
      storedResults.length === 0
        ? {
            status: "empty",
            reason: emptyReason?.message,
            followUps: [],
            confidence: "low",
          }
        : fallback
          ? { status: "fallback", fallback, followUps: [], confidence: "medium" }
          : { status: "exact", followUps: [], confidence: "high" };

    const data_freshness = deriveDataFreshness(
      storedResults as Record<string, unknown>[],
    );
    const source_label = adapter.config.identity.sourceLabel ?? null;

    const insight = await generateInsight(
      storedResults as Record<string, unknown>[],
      plan,
      adapter.config.identity.name,
    );

    recordDomainCoOccurrence(sessionId, adapter.config.identity.name).catch(() => {});
    if (sessionId) {
      updateQueryContext(sessionId, { active_plan: plan, active_poly: poly }).catch(() => {});
    }

    return res.json({
      query_id: queryRecord.id,
      plan,
      poly,
      viz_hint,
      resolved_location,
      intent: routingIntent ?? resolvedIntent ?? null,
      count: storedResults.length,
      months_fetched: effectiveMonths,
      results: storedResults,
      cache_hit: false,
      aggregated,
      chips,
      resultContext,
      source_label,
      data_freshness,
      empty_suggestion: emptyReason?.suggestion ?? null,
      insight,
    });
  } catch (err: any) {
    await prisma.queryJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        error_message: err.message,
        completedAt: new Date(),
      },
    });
    console.log(
      JSON.stringify({
        event: "execute_error",
        domain: adapter.config.identity.name,
        error: err.message,
      }),
    );
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /chip — Phase C.11 ───────────────────────────────────────────────────
//
// Dispatches a chip action. Currently handles:
//   fetch_domain: cinema-showtimes  — scrape live showtimes for a named cinema
//
// Future actions (calculate_travel, overlay_spatial, etc.) will be added here
// as the connected query pipeline grows.

const ChipBodySchema = z.object({
  action: z.string(),
  args: z.object({
    domain: z.string().optional(),
    ref: z.string().optional(),
    cinemaName: z.string().optional(),
    cacheKey: z.string().optional(),
    // W.2 — explicit overrides; when absent, values fall back to session context
    location: z.string().optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
  }),
  sessionId: z.string().optional(),
});

queryRouter.post("/chip", async (req: Request, res: Response) => {
  const parsed = ChipBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: parsed.error.errors });
  }

  const { action, args, sessionId } = parsed.data;

  // C.8 — record this chip click so chip ranking improves over the session
  if (sessionId) {
    recordChipClick(sessionId, action).catch(() => {});
  }

  // ── fetch_domain: cinema-showtimes ────────────────────────────────────────
  if (action === "fetch_domain" && args.domain === "cinema-showtimes") {
    const cinemaName = args.cinemaName;
    if (!cinemaName) {
      return res.status(400).json({ error: "missing_cinema_name" });
    }

    try {
      const { fetchShowtimes } = await import("./domains/cinemas-gb/showtimes");
      const { createEphemeralHandle, pushResultHandle } =
        await import("./conversation-memory");

      const cacheKey =
        args.cacheKey ?? cinemaName.toLowerCase().replace(/\s+/g, "-");
      const rows = await fetchShowtimes(cinemaName, cacheKey);
      const handle = createEphemeralHandle(rows, "cinema-showtimes");

      if (sessionId) {
        await pushResultHandle(sessionId, handle);
      }

      return res.json({
        type: "ephemeral",
        handle,
        rows,
        viz_hint: "table",
      });
    } catch (err: any) {
      return res
        .status(500)
        .json({ error: "chip_execution_error", message: err.message });
    }
  }

  // ── calculate_travel — D.12 ─────────────────────────────────────────────
  if (action === "calculate_travel") {
    const template = getWorkflowById("reachable-area");
    if (!template) {
      return res.status(404).json({ error: "workflow_not_found" });
    }
    return res.json({
      type: "workflow_input_required",
      workflow_id: template.id,
      workflow_name: template.name,
      input_schema: template.input_schema,
    });
  }
  // ── fetch_domain: hunting-day-plan — E.3 ─────────────────────────────────
  if (action === "fetch_domain" && args.domain === "hunting-day-plan") {
    const template = getWorkflowById("hunting-day-plan");
    if (!template) {
      return res.status(404).json({ error: "workflow_not_found" });
    }
    return res.json({
      type: "workflow_input_required",
      workflow_id: template.id,
      workflow_name: template.name,
      description: template.description,
      input_schema: template.input_schema,
    });
  }

  // ── Generic fetch_domain handler — W.1 + W.2 ────────────────────────────
  // Handles any registered domain that isn't a special case above.
  if (action === "fetch_domain" && args.domain) {
    const adapter = getDomainByName(args.domain);
    if (!adapter) {
      return res.status(404).json({
        error: "domain_not_found",
        domain: args.domain,
        message: `Domain '${args.domain}' is not registered.`,
      });
    }

    try {
      // W.2 — read session context for location/poly defaults
      let plan: any = null;
      let poly = "";

      if (sessionId) {
        const ctx = await getQueryContext(sessionId);
        if (ctx?.active_plan) {
          plan = { ...ctx.active_plan };
        }
        if (ctx?.active_poly) {
          poly = ctx.active_poly;
        }

        // If a parent handle ref is supplied, it confirms which result to carry
        // context from (the plan/poly already covers the same session).
        // Future phases can use the handle's capabilities for richer context.
        if (args.ref) {
          const handle = await getResultHandle(sessionId, args.ref);
          if (!handle) {
            console.warn(
              JSON.stringify({
                event: "chip_stale_reference",
                ref: args.ref,
                domain: args.domain,
              }),
            );
          }
        }
      }

      // Chip explicit args override session defaults
      if (args.location) {
        const geocoded = await geocodeToPolygon(args.location, prisma);
        poly = geocoded.poly;
        plan = {
          ...(plan ?? {}),
          location: geocoded.display_name,
        };
      }
      if (args.date_from && plan) {
        plan = { ...plan, date_from: args.date_from };
      }
      if (args.date_to && plan) {
        plan = { ...plan, date_to: args.date_to };
      }

      if (!plan) {
        return res.status(400).json({
          error: "no_context",
          message:
            "No session context found. Run a query first so the chip knows which area to search.",
        });
      }

      const rows = await adapter.fetchData(plan, poly);
      const handle = createEphemeralHandle(rows, args.domain);

      if (sessionId) {
        await pushResultHandle(sessionId, handle);
      }

      const viz_hint =
        adapter.config.visualisation.default ?? "table";

      return res.json({
        type: "ephemeral",
        handle,
        rows,
        viz_hint,
        domain: args.domain,
      });
    } catch (err: any) {
      console.warn(
        JSON.stringify({
          event: "chip_execution_error",
          domain: args.domain,
          error: err.message,
        }),
      );
      return res
        .status(500)
        .json({ error: "chip_execution_error", message: err.message });
    }
  }

  // ── Unhandled action ─────────────────────────────────────────────────────
  return res.status(400).json({
    error: "unsupported_chip_action",
    action,
    domain: args.domain ?? null,
    message: `Chip action '${action}' (domain: ${args.domain ?? "none"}) is not yet implemented.`,
  });
});

// ── POST /synthesise — Phase C ────────────────────────────────────────────────
//
// Accepts the full result stack (primary + chip follow-ups) and a location,
// produces a cross-domain synthesis sentence that directly answers the user's
// implicit question ("is this a good place to live?", "where should I eat?").
//
// Body: { stack: [{ domain, rows, vizHint }], location: string }
// Response: { synthesis: string | null }

const SynthesiseBodySchema = z.object({
  stack: z.array(
    z.object({
      domain:  z.string(),
      rows:    z.array(z.record(z.unknown())),
      vizHint: z.string().optional(),
    }),
  ).min(2),
  location: z.string().min(1),
});

queryRouter.post("/synthesise", async (req: Request, res: Response) => {
  const parsed = SynthesiseBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
  }

  const { stack, location } = parsed.data;

  const synthesis = await synthesiseStack(
    stack.map((e) => ({ domain: e.domain, rows: e.rows, vizHint: e.vizHint ?? "table" })),
    location,
  );

  return res.json({ synthesis });
});

// ── POST /workflow — D.12 ─────────────────────────────────────────────────────

const WorkflowBodySchema = z.object({
  workflow_id: z.string().min(1),
  inputs: z.record(z.unknown()),
});

queryRouter.post("/workflow", async (req: Request, res: Response) => {
  const parsed = WorkflowBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation_error", details: parsed.error.errors });
  }

  const { workflow_id, inputs } = parsed.data;
  const template = getWorkflowById(workflow_id);

  if (!template) {
    return res.status(404).json({
      error: "workflow_not_found",
      message: `No workflow with id '${workflow_id}'`,
    });
  }

  try {
    const result = await executeWorkflow(template, inputs);
    return res.json({ type: "workflow_result", result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "workflow_execution_error", message });
  }
});

// ── GET /history ──────────────────────────────────────────────────────────────

queryRouter.get("/history", async (_req: Request, res: Response) => {
  const records = await prisma.query.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { rows_inserted: true, status: true, cache_hit: true },
      },
    },
  });

  const history = records.map((q) => ({
    query_id: q.id,
    text: q.text,
    category: q.category,
    date_from: q.date_from,
    date_to: q.date_to,
    poly: q.poly,
    resolved_location: q.resolved_location,
    country_code: q.country_code,
    domain: q.domain,
    intent: (q as any).intent ?? null,
    viz_hint: q.viz_hint,
    createdAt: q.createdAt,
    result_count: q.jobs[0]?.rows_inserted ?? null,
    cache_hit: q.jobs[0]?.cache_hit ?? false,
  }));

  return res.json(history);
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

queryRouter.get("/:id", async (req: Request, res: Response) => {
  const record = await prisma.query.findUnique({
    where: { id: req.params.id },
    include: { results: true },
  });

  if (!record) {
    return res.status(404).json({ error: "not_found" });
  }

  return res.json(record);
});
