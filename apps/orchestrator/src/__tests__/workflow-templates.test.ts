/**
 * workflow-templates.test.ts — Phase D.7
 *
 * Tests for WorkflowTemplate seed data:
 *   - all three templates present and well-formed
 *   - findWorkflowsForIntent() matching
 *   - getWorkflowById() lookup
 *   - structural invariants (step ids unique, output_keys unique, input_mappings valid)
 */

import { describe, it, expect } from "vitest";
import {
  WORKFLOW_TEMPLATES,
  getWorkflowById,
  findWorkflowsForIntent,
} from "../workflow-templates";

// ── Registry completeness ─────────────────────────────────────────────────────

describe("WORKFLOW_TEMPLATES registry", () => {
  it("contains exactly 4 templates", () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(4);
  });

  it("contains reachable-area", () => {
    expect(WORKFLOW_TEMPLATES.some((w) => w.id === "reachable-area")).toBe(true);
  });

  it("contains itinerary", () => {
    expect(WORKFLOW_TEMPLATES.some((w) => w.id === "itinerary")).toBe(true);
  });

  it("contains cross-domain-overlay", () => {
    expect(WORKFLOW_TEMPLATES.some((w) => w.id === "cross-domain-overlay")).toBe(true);
  });

  it("every template has a non-empty name and description", () => {
    for (const w of WORKFLOW_TEMPLATES) {
      expect(w.name.length).toBeGreaterThan(0);
      expect(w.description.length).toBeGreaterThan(0);
    }
  });

  it("every template has at least one trigger_intent", () => {
    for (const w of WORKFLOW_TEMPLATES) {
      expect(w.trigger_intents.length).toBeGreaterThan(0);
    }
  });

  it("every template has at least one step", () => {
    for (const w of WORKFLOW_TEMPLATES) {
      expect(w.steps.length).toBeGreaterThan(0);
    }
  });
});

// ── Structural invariants ─────────────────────────────────────────────────────

describe("WorkflowTemplate structural invariants", () => {
  for (const w of WORKFLOW_TEMPLATES) {
    describe(`template: ${w.id}`, () => {
      it("step ids are unique within the template", () => {
        const ids = w.steps.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("output_keys are unique within the template", () => {
        const keys = w.steps.map((s) => s.output_key);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it("every step has at least one input_mapping", () => {
        for (const step of w.steps) {
          expect(step.input_mappings.length).toBeGreaterThan(0);
        }
      });

      it("step_output mappings reference a step id that precedes the current step", () => {
        const seenIds: string[] = [];
        for (const step of w.steps) {
          for (const mapping of step.input_mappings) {
            if (mapping.source === "step_output") {
              const referencedStep = mapping.from.split(".")[0];
              expect(seenIds).toContain(referencedStep);
            }
          }
          seenIds.push(step.id);
        }
      });

      it("workflow_input mappings reference a field in input_schema", () => {
        const inputFields = new Set(w.input_schema.map((f) => f.field));
        for (const step of w.steps) {
          for (const mapping of step.input_mappings) {
            if (mapping.source === "workflow_input") {
              expect(inputFields.has(mapping.from)).toBe(true);
            }
          }
        }
      });

      it("required input_schema fields are all required: true", () => {
        const requiredFields = w.input_schema.filter((f) => f.required);
        expect(requiredFields.length).toBeGreaterThan(0);
      });

      it("select fields have at least 2 options", () => {
        for (const field of w.input_schema) {
          if (field.input_type === "select") {
            expect(field.options?.length).toBeGreaterThanOrEqual(2);
          }
        }
      });
    });
  }
});

// ── getWorkflowById ───────────────────────────────────────────────────────────

describe("getWorkflowById", () => {
  it("returns the correct template for a known id", () => {
    const w = getWorkflowById("reachable-area");
    expect(w).toBeDefined();
    expect(w!.id).toBe("reachable-area");
  });

  it("returns undefined for an unknown id", () => {
    expect(getWorkflowById("non-existent")).toBeUndefined();
  });

  it("is case-sensitive", () => {
    expect(getWorkflowById("Reachable-Area")).toBeUndefined();
  });
});

// ── findWorkflowsForIntent ────────────────────────────────────────────────────

describe("findWorkflowsForIntent", () => {
  it("returns reachable-area for 'isochrone'", () => {
    const results = findWorkflowsForIntent("isochrone from central London");
    expect(results.some((w) => w.id === "reachable-area")).toBe(true);
  });

  it("returns reachable-area for 'how far can i travel'", () => {
    const results = findWorkflowsForIntent("how far can i travel in 20 minutes?");
    expect(results.some((w) => w.id === "reachable-area")).toBe(true);
  });

  it("returns itinerary for 'day out'", () => {
    const results = findWorkflowsForIntent("plan a day out in Bristol");
    expect(results.some((w) => w.id === "itinerary")).toBe(true);
  });

  it("returns itinerary for 'things to do in'", () => {
    const results = findWorkflowsForIntent("things to do in Edinburgh");
    expect(results.some((w) => w.id === "itinerary")).toBe(true);
  });

  it("returns cross-domain-overlay for 'overlay'", () => {
    const results = findWorkflowsForIntent("overlay crime and flood risk");
    expect(results.some((w) => w.id === "cross-domain-overlay")).toBe(true);
  });

  it("returns cross-domain-overlay for 'compare flood risk and crime'", () => {
    const results = findWorkflowsForIntent("compare flood risk and crime in Leeds");
    expect(results.some((w) => w.id === "cross-domain-overlay")).toBe(true);
  });

  it("is case-insensitive", () => {
    const results = findWorkflowsForIntent("ISOCHRONE FROM LONDON");
    expect(results.some((w) => w.id === "reachable-area")).toBe(true);
  });

  it("returns empty array for an unrelated query", () => {
    const results = findWorkflowsForIntent("burglaries in Manchester last month");
    expect(results).toHaveLength(0);
  });

  it("returns most-matching template first when query matches multiple", () => {
    // "overlay" matches cross-domain-overlay; "plan a route" matches itinerary
    // A query that overlaps both — the one with more matches should come first
    const results = findWorkflowsForIntent("overlay and plan a route");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should be the one with more trigger_intent matches
    if (results.length > 1) {
      const firstMatches = results[0].trigger_intents.filter((ti) =>
        "overlay and plan a route".includes(ti),
      ).length;
      const secondMatches = results[1].trigger_intents.filter((ti) =>
        "overlay and plan a route".includes(ti),
      ).length;
      expect(firstMatches).toBeGreaterThanOrEqual(secondMatches);
    }
  });
});

// ── Template-specific content ─────────────────────────────────────────────────

describe("reachable-area template", () => {
  const w = getWorkflowById("reachable-area")!;

  it("requires transport domain", () => {
    expect(w.required_domains).toContain("transport");
  });

  it("has origin, transport_mode, and time_budget_minutes inputs", () => {
    const fields = w.input_schema.map((f) => f.field);
    expect(fields).toContain("origin");
    expect(fields).toContain("transport_mode");
    expect(fields).toContain("time_budget_minutes");
  });

  it("transport_mode is a select with walking and driving options", () => {
    const modeField = w.input_schema.find((f) => f.field === "transport_mode");
    expect(modeField?.input_type).toBe("select");
    expect(modeField?.options).toContain("walking");
    expect(modeField?.options).toContain("driving");
  });

  it("final step outputs the reachable polygon", () => {
    const lastStep = w.steps[w.steps.length - 1];
    expect(lastStep.output_key).toBe("reachable_polygon");
  });
});

describe("itinerary template", () => {
  const w = getWorkflowById("itinerary")!;

  it("requires transport domain", () => {
    expect(w.required_domains).toContain("transport");
  });

  it("has an optional date field", () => {
    const dateField = w.input_schema.find((f) => f.field === "date");
    expect(dateField).toBeDefined();
    expect(dateField!.required).toBe(false);
  });

  it("has a discover-pois step marked optional", () => {
    const poi = w.steps.find((s) => s.id === "discover-pois");
    expect(poi).toBeDefined();
    expect(poi!.optional).toBe(true);
  });
});

describe("cross-domain-overlay template", () => {
  const w = getWorkflowById("cross-domain-overlay")!;

  it("has no required_domains (works with any registered domain)", () => {
    expect(w.required_domains).toHaveLength(0);
  });

  it("has domain_a and domain_b select inputs", () => {
    const fields = w.input_schema.map((f) => f.field);
    expect(fields).toContain("domain_a");
    expect(fields).toContain("domain_b");
  });

  it("final step is the spatial-join", () => {
    const lastStep = w.steps[w.steps.length - 1];
    expect(lastStep.id).toBe("spatial-join");
    expect(lastStep.output_key).toBe("overlay_result");
  });
});
