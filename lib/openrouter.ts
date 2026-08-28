import { getAppReferer, getAppTitle, getOpenRouterApiKey, getOpenRouterModel } from "@/lib/env";
import { redactSecrets } from "@/lib/redact";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatResult = {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

type OpenRouterResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
};

export async function chatCompletion(messages: ChatMessage[]): Promise<ChatResult> {
  const apiKey = getOpenRouterApiKey();
  const requestedModel = getOpenRouterModel();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getAppReferer(),
      "X-Title": getAppTitle(),
    },
    body: JSON.stringify({
      model: requestedModel,
      messages,
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${redactSecrets(raw)}`);
  }

  const json = (await response.json()) as OpenRouterResponse;
  const text = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage ?? {};
  const costUsd = typeof usage.cost === "number" ? usage.cost : 0;

  return {
    text,
    model: json.model || requestedModel,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    costUsd,
  };
}
