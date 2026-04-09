/**
 * workflow-executor.test.ts — Phase D.8
 *
 * Tests for executeWorkflow():
 *   - complete workflow with all steps succeeding
 *   - partial workflow when optional steps fail/skip
 *   - failed workflow when a required step errors
 *   - not_implemented for unregistered domains
 *   - input_mapping resolution (workflow_input + step_output)
 *   - domain token substitution ({{domain_a}})
 *   - handle accumulation and ordering
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeWorkflow } from "../workflow-executor";
import type { WorkflowTemplate } from "../types/connected";

// ── Mock the domain registry ──────────────────────────────────────────────────

vi.mock("../domains/registry", () => {
  const adapters = new Map<string, unknown>();
  return {
    getDomainByName: (name: string) => adapters.get(name),
    __adapters: adapters,
  };
});

vi.mock("../conversation-memory", () => ({
  createEphemeralHandle: (rows: unknown[], domain: string) => ({
    id:           `ephemeral_test_${domain}`,
    type:         domain,
    domain,
    capabilities: [],
    ephemeral:    true,
    rowCount:     (rows as unknown[]).length,
    data:         rows,
  }),
  inferCapabilities: () => [],
}));

// Helper to inject a mock adapter into the registry
async function registerMockAdapter(
  name: string,
  rows: Record<string, unknown>[],
  shouldThrow = false,
) {
  const { __adapters } = await import("../domains/registry") as any;
  __adapters.set(name, {
    config:    { name },
    fetchData: shouldThrow
      ? async () => { throw new Error(`${name} fetch failed`); }
      : async () => rows,
    flattenRow: (r: unknown) => r as Record<string, unknown>,
  });
}

async function clearAdapters() {
  const { __adapters } = await import("../domains/registry") as any;
  __adapters.clear();
}

// ── Fixture templates ─────────────────────────────────────────────────────────

const TWO_STEP: WorkflowTemplate = {
  id:               "test-two-step",
  name:             "Two Step",
  description:      "Test template with two sequential steps.",
  trigger_intents:  ["test"],
  required_domains: ["domain-a", "domain-b"],
  input_schema: [
    { field: "location", prompt: "Where?", input_type: "text", required: true },
  ],
  steps: [
    {
      id:          "step-a",
      domain:      "domain-a",
      description: "First step",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "location" },
      ],
      output_key: "result_a",
    },
    {
      id:          "step-b",
      domain:      "domain-b",
      description: "Second step — references first step output",
      input_mappings: [
        { targetField: "location",   source: "workflow_input", from: "location" },
        { targetField: "source_row", source: "step_output",    from: "step-a.name" },
      ],
      output_key: "result_b",
    },
  ],
};

const OPTIONAL_STEP: WorkflowTemplate = {
  id:               "test-optional",
  name:             "Optional Step",
  description:      "Template with an optional step that may fail.",
  trigger_intents:  ["test-optional"],
  required_domains: ["domain-a"],
  input_schema: [
    { field: "location", prompt: "Where?", input_type: "text", required: true },
  ],
  steps: [
    {
      id:          "required-step",
      domain:      "domain-a",
      description: "Required step",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "location" },
      ],
      output_key: "required_result",
    },
    {
      id:          "optional-step",
      domain:      "domain-missing",
      description: "Optional step that will not find an adapter",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "location" },
      ],
      output_key:  "optional_result",
      optional:    true,
    },
  ],
};

const DYNAMIC_DOMAIN: WorkflowTemplate = {
  id:               "test-dynamic",
  name:             "Dynamic Domain",
  description:      "Template with token-substituted domain slug.",
  trigger_intents:  ["test-dynamic"],
  required_domains: [],
  input_schema: [
    { field: "location",  prompt: "Where?",       input_type: "text",   required: true },
    {
      field:      "chosen_domain",
      prompt:     "Which domain?",
      input_type: "select",
      options:    ["domain-a", "domain-b"],
      required:   true,
    },
  ],
  steps: [
    {
      id:          "dynamic-step",
      domain:      "{{chosen_domain}}",
      description: "Calls whichever domain the user chose",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "location" },
      ],
      output_key: "dynamic_result",
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await clearAdapters();
});

describe("executeWorkflow — complete success", () => {
  it("returns status: complete when all steps succeed", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha", lat: 51.5, lon: -0.1 }]);
    await registerMockAdapter("domain-b", [{ name: "Beta" }]);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.status).toBe("complete");
  });

  it("returns a handle for every successful step", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);
    await registerMockAdapter("domain-b", [{ name: "Beta" }]);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.handles).toHaveLength(2);
  });

  it("handles are in step order", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);
    await registerMockAdapter("domain-b", [{ name: "Beta" }]);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.handles[0].domain).toBe("domain-a");
    expect(result.handles[1].domain).toBe("domain-b");
  });

  it("step_results has an entry for every step", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);
    await registerMockAdapter("domain-b", [{ name: "Beta" }]);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.step_results).toHaveLength(2);
    expect(result.step_results[0].step_id).toBe("step-a");
    expect(result.step_results[1].step_id).toBe("step-b");
  });

  it("all step statuses are success", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);
    await registerMockAdapter("domain-b", [{ name: "Beta" }]);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    for (const sr of result.step_results) {
      expect(sr.status).toBe("success");
    }
  });

  it("workflow_id matches template id", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);
    await registerMockAdapter("domain-b", [{ name: "Beta" }]);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.workflow_id).toBe("test-two-step");
  });
});

describe("executeWorkflow — step_output mapping", () => {
  it("step B receives value from step A's output row", async () => {
    const rowsA = [{ name: "Alpha", lat: 51.5, lon: -0.1 }];
    await registerMockAdapter("domain-a", rowsA);

    let capturedInputs: Record<string, unknown> = {};
    const { __adapters } = await import("../domains/registry") as any;
    __adapters.set("domain-b", {
      config:    { name: "domain-b" },
      fetchData: async (_plan: unknown, _loc: string) => {
        capturedInputs = _plan as Record<string, unknown>;
        return [{ name: "Beta" }];
      },
      flattenRow: (r: unknown) => r as Record<string, unknown>,
    });

    await executeWorkflow(TWO_STEP, { location: "London" });
    // step-b maps source_row from step-a.name — should be "Alpha"
    expect(capturedInputs.source_row).toBe("Alpha");
  });
});

describe("executeWorkflow — optional steps", () => {
  it("returns status: partial when optional step has no adapter", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);
    // domain-missing intentionally not registered

    const result = await executeWorkflow(OPTIONAL_STEP, { location: "London" });
    expect(result.status).toBe("partial");
  });

  it("required step handle is still in handles when optional fails", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);

    const result = await executeWorkflow(OPTIONAL_STEP, { location: "London" });
    expect(result.handles).toHaveLength(1);
    expect(result.handles[0].domain).toBe("domain-a");
  });

  it("optional step result has status not_implemented", async () => {
    await registerMockAdapter("domain-a", [{ name: "Alpha" }]);

    const result = await executeWorkflow(OPTIONAL_STEP, { location: "London" });
    const optResult = result.step_results.find((r) => r.step_id === "optional-step");
    expect(optResult?.status).toBe("not_implemented");
  });

  it("returns partial when optional step throws", async () => {
    await registerMockAdapter("domain-a", []);
    const { __adapters } = await import("../domains/registry") as any;
    __adapters.set("domain-throws", {
      config:     { name: "domain-throws" },
      fetchData:  async () => { throw new Error("adapter error"); },
      flattenRow: (r: unknown) => r as Record<string, unknown>,
    });

    const templateWithThrow: WorkflowTemplate = {
      ...OPTIONAL_STEP,
      steps: [
        OPTIONAL_STEP.steps[0],
        {
          ...OPTIONAL_STEP.steps[1],
          domain:   "domain-throws",
          optional: true,
        },
      ],
    };

    const result = await executeWorkflow(templateWithThrow, { location: "London" });
    expect(result.status).toBe("partial");
  });
});

describe("executeWorkflow — required step failure", () => {
  it("returns status: failed when required step throws", async () => {
    await registerMockAdapter("domain-a", [], true); // throws

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.status).toBe("failed");
  });

  it("stops after the failing required step", async () => {
    await registerMockAdapter("domain-a", [], true);
    await registerMockAdapter("domain-b", [{ name: "Beta" }]);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    // Only step-a ran (and failed); step-b never executed
    expect(result.step_results).toHaveLength(1);
  });

  it("returns no handles when required first step fails", async () => {
    await registerMockAdapter("domain-a", [], true);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.handles).toHaveLength(0);
  });
});

describe("executeWorkflow — not_implemented (virtual) domains", () => {
  const GEO_TEMPLATE: WorkflowTemplate = {
    id:               "test-geo",
    name:             "Geocoder test",
    description:      "Tests virtual geocoder domain",
    trigger_intents:  ["test-geo"],
    required_domains: [],
    input_schema: [
      { field: "origin", prompt: "Start?", input_type: "text", required: true },
    ],
    steps: [
      {
        id:          "geocode",
        domain:      "geocoder",
        description: "Virtual geocoder — not yet registered",
        input_mappings: [
          { targetField: "location", source: "workflow_input", from: "origin" },
        ],
        output_key: "coords",
        optional:   true,
      },
    ],
  };

  it("virtual geocoder step returns not_implemented", async () => {
    const result = await executeWorkflow(GEO_TEMPLATE, { origin: "London" });
    expect(result.step_results[0].status).toBe("not_implemented");
  });

  it("workflow is partial (not failed) when virtual step is optional", async () => {
    const result = await executeWorkflow(GEO_TEMPLATE, { origin: "London" });
    expect(result.status).toBe("partial");
  });
});

describe("executeWorkflow — domain token substitution", () => {
  it("substitutes {{chosen_domain}} from inputs", async () => {
    await registerMockAdapter("domain-a", [{ name: "FromA" }]);

    const result = await executeWorkflow(DYNAMIC_DOMAIN, {
      location:       "London",
      chosen_domain:  "domain-a",
    });
    expect(result.handles[0].domain).toBe("domain-a");
  });

  it("substituting to an unregistered domain returns not_implemented", async () => {
    const result = await executeWorkflow(DYNAMIC_DOMAIN, {
      location:      "London",
      chosen_domain: "no-such-domain",
    });
    expect(result.step_results[0].status).toBe("not_implemented");
  });
});

describe("executeWorkflow — empty rows", () => {
  it("succeeds with zero-row result when adapter returns empty array", async () => {
    await registerMockAdapter("domain-a", []);
    await registerMockAdapter("domain-b", []);

    const result = await executeWorkflow(TWO_STEP, { location: "London" });
    expect(result.status).toBe("complete");
    expect(result.handles[0].rowCount).toBe(0);
  });
});
