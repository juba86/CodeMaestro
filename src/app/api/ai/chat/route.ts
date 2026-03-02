import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/ai/provider-factory";
import type { ProviderName, ChatMessage } from "@/lib/ai/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      systemPrompt,
      provider: providerName,
      model,
      stream,
      apiKey: clientApiKey,
    } = body as {
      messages: ChatMessage[];
      systemPrompt?: string;
      provider: ProviderName;
      model?: string;
      stream?: boolean;
      apiKey?: string;
    };

    // Get API key from request or env
    const apiKey =
      clientApiKey ||
      (providerName === "claude"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.GOOGLE_API_KEY) ||
      "";

    if (!apiKey) {
      return NextResponse.json(
        { error: "No API key configured. Set it in Settings." },
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
    });

    return NextResponse.json({ content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
