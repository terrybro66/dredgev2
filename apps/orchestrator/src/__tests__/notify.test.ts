import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegramMessage } from "../notify";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true });
});

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

describe("sendTelegramMessage()", () => {
  it("does nothing when TELEGRAM_BOT_TOKEN is absent", async () => {
    process.env.TELEGRAM_CHAT_ID = "123";
    await sendTelegramMessage("hello");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when TELEGRAM_CHAT_ID is absent", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    await sendTelegramMessage("hello");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls the Telegram sendMessage endpoint with correct body", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok123";
    process.env.TELEGRAM_CHAT_ID = "456";

    await sendTelegramMessage("test message");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottok123/sendMessage");
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      chat_id: "456",
      text: "test message",
      parse_mode: "Markdown",
    });
  });

  it("does not throw when fetch throws", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    process.env.TELEGRAM_CHAT_ID = "123";
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(sendTelegramMessage("hello")).resolves.not.toThrow();
  });
});
