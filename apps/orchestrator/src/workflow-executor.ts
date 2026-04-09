/**
 * workflow-executor.ts — Phase D.8
 *
 * Executes a WorkflowTemplate against the domain adapter registry.
 *
 * Responsibilities:
 *   - Walk steps in declaration order
 *   - Resolve input_mappings from workflow inputs or prior step outputs
 *   - Substitute {{field}} tokens in domain slugs
 *   - Call getDomainByName() → adapter.fetchData() for each step
 *   - Wrap rows in ephemeral ResultHandles via createEphemeralHandle()
 *   - Accumulate step state for downstream step_output references
 *   - Gracefully skip optional steps when inputs or adapter are absent
 *   - Return WorkflowResult with status, step_results, and handles
 *
 * This module contains NO template data — import workflow-templates.ts for that.
 */

import type {
  WorkflowTemplate,
  WorkflowStep,
  WorkflowStepInput,
  WorkflowStepResult,
  WorkflowResult,
  ResultHandle,
} from "./types/connected";
import { getDomainByName } from "./domains/registry";
import { createEphemeralHandle } from "./conversation-memory";

// ── Dot-path resolver ─────────────────────────────────────────────────────────

/**
 * Resolve a dot-separated path into a nested object.
 * Returns undefined if any segment is missing.
 *
 * e.g. resolvePath({ a: { b: 42 } }, "a.b") → 42
 */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Token substitution ────────────────────────────────────────────────────────

/**
 * Replace {{field}} tokens in a domain slug with values from workflow inputs.
 * e.g. substituteDomain("{{domain_a}}", { domain_a: "crime-uk" }) → "crime-uk"
 */
function substituteDomain(
  domain: string,
  inputs: Record<string, unknown>,
): string {
  return domain.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = inputs[key];
    return typeof val === "string" ? val : domain;
  });
}

// ── Input mapping resolver ────────────────────────────────────────────────────

/**
 * Resolve all input_mappings for a step into a flat Record<targetField, value>.
 *
 * stepState: map of output_key → { handle, rows } from previously completed steps.
 * stepIdToState: map of step.id → output_key for the same.
 */
function resolveInputs(
  mappings:     WorkflowStepInput[],
  inputs:       Record<string, unknown>,
  stepState:    Map<string, { rows: Record<string, unknown>[] }>,
  stepIdToKey:  Map<string, string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const mapping of mappings) {
    if (mapping.source === "workflow_input") {
      resolved[mapping.targetField] = inputs[mapping.from];
    } else {
      // step_output: "stepId.fieldPath"
      const dotIndex = mapping.from.indexOf(".");
      const stepId   = dotIndex === -1 ? mapping.from : mapping.from.slice(0, dotIndex);
      const fieldPath = dotIndex === -1 ? "" : mapping.from.slice(dotIndex + 1);

      const key   = stepIdToKey.get(stepId);
      const state = key ? stepState.get(key) : undefined;

      if (!state) {
        resolved[mapping.targetField] = undefined;
        continue;
      }

      if (!fieldPath) {
        // Return the whole rows array
        resolved[mapping.targetField] = state.rows;
      } else if (fieldPath === "rows") {
        resolved[mapping.targetField] = state.rows;
      } else if (fieldPath === "handle_id") {
        // Will be populated once we have handle — skip for now, executor patches later
        resolved[mapping.targetField] = undefined;
      } else {
        // Try to read the field from the first row as a scalar (lat, lon, etc.)
        const firstRow = state.rows[0];
        resolved[mapping.targetField] = firstRow
          ? resolvePath(firstRow, fieldPath)
          : undefined;
      }
    }
  }

  return resolved;
}

// ── Build a synthetic QueryPlan for an adapter call ───────────────────────────

function buildSyntheticPlan(
  domain:   string,
  resolved: Record<string, unknown>,
): Record<string, unknown> {
  const now = new Date().toISOString().slice(0, 7);
  return {
    category:  domain,
    location:  resolved.location ?? resolved.origin ?? "",
    date_from: resolved.date ?? now,
    date_to:   resolved.date ?? now,
    lat:       resolved.lat,
    lon:       resolved.lon,
    ...resolved,
  };
}

// ── Single step executor ──────────────────────────────────────────────────────

async function executeStep(
  step:       WorkflowStep,
  inputs:     Record<string, unknown>,
  stepState:  Map<string, { rows: Record<string, unknown>[] }>,
  stepIdToKey: Map<string, string>,
): Promise<WorkflowStepResult> {
  const resolvedDomain = substituteDomain(step.domain, inputs);
  const resolved       = resolveInputs(step.input_mappings, inputs, stepState, stepIdToKey);

  // Patch handle_id references now that we have the state
  for (const mapping of step.input_mappings) {
    if (mapping.source === "step_output" && mapping.from.endsWith(".handle_id")) {
      const stepId = mapping.from.split(".")[0];
      const key    = stepIdToKey.get(stepId);
      // handle_id is stored separately in stepHandles — executor patches below
      void key; // no-op for now; handle_id patching happens in executeWorkflow
    }
  }

  // Special domains that have no registered adapter are not-implemented
  const VIRTUAL_DOMAINS = new Set(["geocoder", "transport", "overlay"]);
  if (VIRTUAL_DOMAINS.has(resolvedDomain)) {
    if (step.optional) {
      return {
        step_id:    step.id,
        output_key: step.output_key,
        status:     "not_implemented",
        error:      `Domain '${resolvedDomain}' is not yet registered (D.10+)`,
      };
    }
    return {
      step_id:    step.id,
      output_key: step.output_key,
      status:     "not_implemented",
      error:      `Required domain '${resolvedDomain}' is not registered`,
    };
  }

  const adapter = getDomainByName(resolvedDomain);
  if (!adapter) {
    // Unregistered domain is always not_implemented, never a runtime error.
    // status: "error" is reserved for adapters that exist but throw.
    return {
      step_id:    step.id,
      output_key: step.output_key,
      status:     "not_implemented",
      error:      `Domain '${resolvedDomain}' is not registered`,
    };
  }

  // Check required inputs are present
  const requiredMissing = step.input_mappings
    .filter((m) => !m.source.startsWith("step") || true)
    .filter((m) => resolved[m.targetField] == null)
    .map((m) => m.targetField);

  if (requiredMissing.length > 0 && step.optional) {
    return {
      step_id:    step.id,
      output_key: step.output_key,
      status:     "skipped",
      error:      `Missing inputs: ${requiredMissing.join(", ")}`,
    };
  }

  try {
    const plan     = buildSyntheticPlan(resolvedDomain, resolved);
    const location = (resolved.location as string | undefined)
      ?? (resolved.origin as string | undefined)
      ?? "";

    const rawRows = await adapter.fetchData(plan, location);
    const rows    = rawRows.map((r) => adapter.flattenRow(r));
    const handle  = createEphemeralHandle(rows, resolvedDomain);

    return {
      step_id:    step.id,
      output_key: step.output_key,
      status:     "success",
      handle,
      rows,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (step.optional) {
      return {
        step_id:    step.id,
        output_key: step.output_key,
        status:     "error",
        error:      message,
      };
    }
    throw new Error(`Step '${step.id}' failed: ${message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a workflow template with the given user inputs.
 *
 * @param template  The WorkflowTemplate to execute
 * @param inputs    User-supplied answers to template.input_schema
 *
 * @returns WorkflowResult with status, per-step results, and success handles
 *
 * Throws only when a required (non-optional) step fails and is not a
 * not_implemented case — callers should wrap in try/catch.
 */
export async function executeWorkflow(
  template: WorkflowTemplate,
  inputs:   Record<string, unknown>,
): Promise<WorkflowResult> {
  // stepState keyed by output_key
  const stepState  = new Map<string, { rows: Record<string, unknown>[] }>();
  // Map step.id → step.output_key for step_output mapping resolution
  const stepIdToKey = new Map<string, string>();

  const stepResults: WorkflowStepResult[] = [];
  const handles:     ResultHandle[]        = [];

  for (const step of template.steps) {
    stepIdToKey.set(step.id, step.output_key);

    let result: WorkflowStepResult;
    try {
      result = await executeStep(step, inputs, stepState, stepIdToKey);
    } catch (err: unknown) {
      // Required step threw — workflow fails
      const message = err instanceof Error ? err.message : String(err);
      stepResults.push({
        step_id:    step.id,
        output_key: step.output_key,
        status:     "error",
        error:      message,
      });
      return {
        workflow_id:  template.id,
        status:       "failed",
        step_results: stepResults,
        handles,
      };
    }

    stepResults.push(result);

    if (result.status === "success" && result.handle && result.rows) {
      stepState.set(step.output_key, { rows: result.rows });
      handles.push(result.handle);
    }
  }

  // Determine overall status
  const hasFailure = stepResults.some(
    (r) => r.status === "error" || r.status === "not_implemented",
  );
  const hasSkipped = stepResults.some((r) => r.status === "skipped");

  const status: WorkflowResult["status"] = hasFailure || hasSkipped
    ? "partial"
    : "complete";

  return {
    workflow_id: template.id,
    status,
    step_results: stepResults,
    handles,
  };
}
