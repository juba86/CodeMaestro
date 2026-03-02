import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/ai/provider-factory";
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

    // Get API key from request or env
    const apiKey =
      clientApiKey ||
      (providerName === "claude"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.GOOGLE_API_KEY) ||
      "";

    if (!apiKey) {
      return NextResponse.json(
        { error: "No API key configured. Set it in Settings.", code: "MISSING_API_KEY" },
        { status: 400 }
      );
    }

    const provider = createProvider(providerName, apiKey);

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
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
