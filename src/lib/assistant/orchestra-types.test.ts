import { describe, expect, it } from "vitest";
import { autoConductor, contextTokens, strongestGeneral, strongestWorker, type OrchestraWorkerInfo } from "./orchestra-types";

describe("contextTokens", () => {
  it("reads the reported context window first", () => {
    expect(contextTokens({ id: "qwen3.8:27b-256k", contextWindow: 65536 })).toBe(65536);
  });

  it("falls back to a -64k/-256k tag suffix and 0 when unknown", () => {
    expect(contextTokens({ id: "qwen3.8:27b-64k" })).toBe(65536);
    expect(contextTokens({ id: "qwen3.8:27b-256k" })).toBe(262144);
    expect(contextTokens({ id: "qwen3.8:27b" })).toBe(0);
    expect(contextTokens({ id: "gemma4:26b-a4b-it-q8_0" })).toBe(0);
  });
});

describe("strongestGeneral", () => {
  it("prefers the smaller context variant of the same model", () => {
    // The 256k tag used to win by alphabetical accident ("-2" < "-6"): its KV
    // cache is several times larger and is the first thing a shared GPU evicts.
    const models = [{ id: "qwen3.8:27b-256k" }, { id: "qwen3.8:27b-64k" }];
    expect(strongestGeneral(models)?.id).toBe("qwen3.8:27b-64k");
    expect(strongestGeneral([...models].reverse())?.id).toBe("qwen3.8:27b-64k");
  });

  it("still ranks the exact tag above any variant", () => {
    expect(strongestGeneral([{ id: "qwen3.8:27b-64k" }, { id: "qwen3.8:27b" }])?.id).toBe("qwen3.8:27b");
  });

  it("uses a reported context window over the tag suffix", () => {
    const models = [
      { id: "qwen3.8:27b-a", contextWindow: 262144 },
      { id: "qwen3.8:27b-b", contextWindow: 65536 },
    ];
    expect(strongestGeneral(models)?.id).toBe("qwen3.8:27b-b");
  });

  it("keeps the priority list and parameter count ahead of context", () => {
    const models = [{ id: "qwen3.8:27b-256k" }, { id: "phi4:14b-64k" }];
    expect(strongestGeneral(models)?.id).toBe("qwen3.8:27b-256k");
  });
});

function worker(id: string, extra: Partial<OrchestraWorkerInfo> = {}): OrchestraWorkerInfo {
  return { id: `ollama:${id}`, kind: "ollama", label: id, editsFiles: false, local: true, model: id, ...extra };
}

describe("strongestWorker", () => {
  it("does not depend on the order Ollama lists its tags in", () => {
    const a = worker("qwen3.8:27b-256k");
    const b = worker("qwen3.8:27b-64k");
    expect(strongestWorker([a, b])?.id).toBe(b.id);
    expect(strongestWorker([b, a])?.id).toBe(b.id);
  });

  it("uses the worker's own context window when present", () => {
    const big = worker("qwen3.8:27b-x", { contextWindow: 262144 });
    const small = worker("qwen3.8:27b-y", { contextWindow: 65536 });
    expect(strongestWorker([big, small])?.id).toBe(small.id);
  });
});

describe("autoConductor", () => {
  it("picks the smaller-context local text model when no CLI is installed", () => {
    const workers = [worker("qwen3.8:27b-256k"), worker("qwen3.8:27b-64k"), worker("qwen3-coder:30b-64k")];
    expect(autoConductor(workers)?.model).toBe("qwen3.8:27b-64k");
  });
});
