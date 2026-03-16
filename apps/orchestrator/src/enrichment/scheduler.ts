import { DomainAdapter } from "../domains/registry";
import { createSnapshot } from "../execution-model";

export const refreshScheduler = {
  isEnabled(): boolean {
    return process.env.REFRESH_SCHEDULER_ENABLED === "true";
  },

  scheduleRefresh(adapter: DomainAdapter, prisma: unknown): void {
    // Phase 9 stub — real implementation wires in node-cron
    // Registers the adapter for periodic refresh based on refreshPolicy
    console.log(
      JSON.stringify({
        event: "refresh_scheduled",
        domain: adapter.config.name,
        sources: adapter.config.sources?.map((s) => s.url) ?? [],
      }),
    );
  },

  async runRefresh(adapter: DomainAdapter, prisma: any): Promise<void> {
    const rows = await adapter.fetchData({}, "");

    await createSnapshot({
      queryId: `refresh:${adapter.config.name}:${Date.now()}`,
      sourceSet: adapter.config.sources?.map((s) => s.url) ?? [
        adapter.config.apiUrl,
      ],
      schemaVersion: "1.0",
      rows,
      prisma,
    });
  },
};
