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
          headless: false,
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
          timeoutMs: 60000,
        });

        // Wait for dynamic content like the working script does
        await page.waitForSelector("body", { timeout: 10000 });
        await page.waitForTimeout(4000);

        try {
          // Use the same schema as the working script
          const result = await stagehand.extract(
            options.extractionPrompt,
            z.object({
              cinema: z.string().nullable(),
              movies: z.array(z.string()),
            }),
            { page },
          );

          const movies = (result as any)?.movies ?? [];
          return Array.isArray(movies)
            ? movies.map((title: string) => ({ title }))
            : [];
        } catch (err: any) {
          // gpt-4o-mini via OpenRouter always wraps response in { type, properties }
          // The data is in err.text even for non-NoObjectGeneratedError failures
          if (err?.text) {
            try {
              const parsed = JSON.parse(err.text);
              const unwrapped = parsed?.properties ?? parsed;
              const movies = unwrapped?.movies ?? unwrapped?.items ?? [];
              if (Array.isArray(movies) && movies.length > 0) {
                return movies.map((title: string) => ({ title }));
              }
            } catch {
              // fall through
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
