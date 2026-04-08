import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

interface ScrapeProviderOptions {
  extractionPrompt: string;
}

/**
 * Generic row schema: each item is a flat key/value object.
 * Works for any domain — cinema titles, train times, pharmacy listings, etc.
 * The extractionPrompt instructs the LLM what fields to populate.
 */
const ROW_SCHEMA = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
});

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
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            // Spoof a real Chrome user-agent so sites don't detect headless mode
            "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          ],
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

        // Wait for dynamic content to render
        await page.waitForSelector("body", { timeout: 10000 });
        await page.waitForTimeout(4000);

        try {
          const result = await stagehand.extract(
            options.extractionPrompt,
            ROW_SCHEMA,
            { page },
          );

          const items = (result as any)?.items ?? [];
          return Array.isArray(items)
            ? (items as Record<string, unknown>[])
            : [];
        } catch (err: any) {
          // gpt-4o-mini via OpenRouter sometimes wraps response in { type, properties }
          // The data is in err.text even for non-NoObjectGeneratedError failures
          if (err?.text) {
            try {
              const parsed = JSON.parse(err.text);
              const unwrapped = parsed?.properties ?? parsed;
              const items = unwrapped?.items ?? [];
              if (Array.isArray(items) && items.length > 0) {
                return items as Record<string, unknown>[];
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
        // Timeout close() so a stuck consent modal never hangs the process
        await Promise.race([
          stagehand.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]).catch(() => {});
      }
    },
  };
}
