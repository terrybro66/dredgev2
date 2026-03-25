import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

interface ScrapeProviderOptions {
  extractionPrompt: string;
}

export function createScrapeProvider(options: ScrapeProviderOptions) {
  return {
    async fetchRows(url: string): Promise<Record<string, unknown>[]> {
      const stagehand = new Stagehand({
        env: "LOCAL",
        model: {
          modelName: "openai/gpt-4o-mini",
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: "https://openrouter.ai/api/v1",
        },
        localBrowserLaunchOptions: {
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      });

      try {
        await stagehand.init();

        let page = stagehand.context.pages()[0];
        if (!page) {
          page = await stagehand.context.newPage();
        }

        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeoutMs: 30000,
        });

        try {
          const result = await stagehand.extract(
            options.extractionPrompt,
            z.object({
              items: z
                .array(z.record(z.string(), z.unknown().nullable()))
                .nullable(),
            }),
            { page },
          );

          const items = (result as any)?.items ?? (result as any)?.movies ?? [];
          return Array.isArray(items) ? items : [];
        } catch (err: any) {
          // Fallback: parse raw text from NoObjectGeneratedError
          if (err?.name === "NoObjectGeneratedError" && err?.text) {
            try {
              const parsed = JSON.parse(err.text);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          }
          console.warn("[ScrapeProvider] extraction failed:", err?.message);
          return [];
        }
      } catch (err: any) {
        console.warn("[ScrapeProvider] page error:", err?.message);
        return [];
      } finally {
        await stagehand.close().catch(() => {});
      }
    },
  };
}
