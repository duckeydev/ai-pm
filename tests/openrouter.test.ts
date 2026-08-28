import { afterEach, describe, expect, it, vi } from "vitest";

describe("chatCompletion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  it("POSTs to OpenRouter with Bearer, Referer, X-Title and prefers usage.cost", async () => {
    process.env.OPENROUTER_API_KEY = "sk-live-test";
    process.env.OPENROUTER_MODEL = "openai/gpt-4.1-mini";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openai/gpt-4.1-mini",
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 3, completion_tokens: 5, cost: 0.0123 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/openrouter");
    const result = await chatCompletion([{ role: "user", content: "hi" }]);

    expect(result).toEqual({
      text: "hello",
      model: "openai/gpt-4.1-mini",
      promptTokens: 3,
      completionTokens: 5,
      costUsd: 0.0123,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-live-test");
    expect(headers["HTTP-Referer"]).toBeTruthy();
    expect(headers["X-Title"]).toBe("ai-pm");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("openai/gpt-4.1-mini");
  });
});
