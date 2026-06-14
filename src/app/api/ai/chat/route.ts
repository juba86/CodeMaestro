import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/ai/provider-factory";
import { GeminiCliProvider } from "@/lib/ai/gemini-cli-provider";
import { ClaudeCliProvider } from "@/lib/ai/claude-cli-provider";
import { getSetting } from "@/lib/settings";
import { chatRequestSchema, formatZodError } from "@/lib/validation/schemas";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const result = chatRequestSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: formatZodError(result.error), code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { messages, systemPrompt, provider: providerName, model, stream, apiKey: clientApiKey, maxTokens, temperature } = result.data;

    // Claude/Gemini can run via their locally logged-in CLI instead of an API key.
    const geminiOauth =
      providerName === "gemini" && (await getSetting("geminiAuthMode", "key")) === "oauth";
    const claudeLogin =
      providerName === "claude" && (await getSetting("claudeAuthMode", "key")) === "oauth";

    // Local providers (Ollama) and CLI-login providers run without an API key.
    const requiresKey = providerName !== "ollama" && !geminiOauth && !claudeLogin;

    // Get API key from request or env
    const apiKey =
      clientApiKey ||
      (providerName === "claude"
        ? process.env.ANTHROPIC_API_KEY
        : providerName === "gemini"
          ? process.env.GOOGLE_API_KEY
          : "") ||
      "";

    if (requiresKey && !apiKey) {
      return NextResponse.json(
        { error: "No API key configured. Set it in Settings.", code: "MISSING_API_KEY" },
        { status: 400 }
      );
    }

    const provider = geminiOauth
      ? new GeminiCliProvider()
      : claudeLogin
        ? new ClaudeCliProvider()
        : createProvider(providerName, apiKey);

    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of provider.streamMessage({
              messages,
              systemPrompt,
              model,
              maxTokens,
              temperature,
            })) {
              const data = `data: ${JSON.stringify(chunk)}\n\n`;
              controller.enqueue(encoder.encode(data));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", content: errMsg })}\n\n`)
            );
            // Always terminate the SSE stream so the client's reader loop exits
            // promptly instead of waiting for a network timeout.
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const content = await provider.sendMessage({
      messages,
      systemPrompt,
      model,
      maxTokens,
      temperature,
    });

    return NextResponse.json({ content });
  } catch (err) {
    console.error("[POST /api/ai/chat]", err);
    // Surface the real upstream/provider error so the UI can show what actually
    // went wrong (e.g. model not found, quota, key restriction) instead of a
    // generic message.
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { error: message, code: "PROVIDER_ERROR" },
      { status: 502 }
    );
  }
}
