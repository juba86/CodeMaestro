import { create } from "zustand";
import type { PromptStructured, PromptExample, ChatMessage, SwarmConfig } from "@/lib/ai/types";

type BuilderStep = "form" | "edit" | "preview" | "refine";

interface BuilderState {
  step: BuilderStep;
  projectGoal: string;
  structured: PromptStructured;
  xmlContent: string;
  chatMessages: ChatMessage[];
  isGenerating: boolean;
  currentPromptId: string | null;

  setStep: (step: BuilderStep) => void;
  setProjectGoal: (goal: string) => void;
  updateStructured: (data: Partial<PromptStructured>) => void;
  setXmlContent: (xml: string) => void;
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: () => void;
  setIsGenerating: (v: boolean) => void;
  setCurrentPromptId: (id: string | null) => void;
  addExample: (example: PromptExample) => void;
  updateExample: (id: string, example: Partial<PromptExample>) => void;
  removeExample: (id: string) => void;
  setSwarmConfig: (config: SwarmConfig | undefined) => void;
  reset: () => void;
}

const emptyStructured: PromptStructured = {
  instructions: "",
  context: "",
  constraints: "",
  examples: [],
  task: "",
  targetAudience: "",
  outputFormat: "",
  swarmConfig: undefined,
};

export const useBuilderStore = create<BuilderState>()((set) => ({
  step: "form",
  projectGoal: "",
  structured: { ...emptyStructured },
  xmlContent: "",
  chatMessages: [],
  isGenerating: false,
  currentPromptId: null,

  setStep: (step) => set({ step }),
  setProjectGoal: (projectGoal) => set({ projectGoal }),
  updateStructured: (data) =>
    set((s) => ({ structured: { ...s.structured, ...data } })),
  setXmlContent: (xmlContent) => set({ xmlContent }),
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  clearChat: () => set({ chatMessages: [] }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setCurrentPromptId: (currentPromptId) => set({ currentPromptId }),
  addExample: (example) =>
    set((s) => ({
      structured: {
        ...s.structured,
        examples: [...s.structured.examples, example],
      },
    })),
  updateExample: (id, example) =>
    set((s) => ({
      structured: {
        ...s.structured,
        examples: s.structured.examples.map((e) =>
          e.id === id ? { ...e, ...example } : e
        ),
      },
    })),
  removeExample: (id) =>
    set((s) => ({
      structured: {
        ...s.structured,
        examples: s.structured.examples.filter((e) => e.id !== id),
      },
    })),
  setSwarmConfig: (config) =>
    set((s) => ({
      structured: { ...s.structured, swarmConfig: config },
    })),
  reset: () =>
    set({
      step: "form",
      projectGoal: "",
      structured: { ...emptyStructured },
      xmlContent: "",
      chatMessages: [],
      isGenerating: false,
      currentPromptId: null,
    }),
}));
