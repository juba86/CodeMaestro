import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PromptStructured, PromptExample, ChatMessage, SwarmConfig } from "@/lib/ai/types";

type BuilderStep = "form" | "edit" | "preview" | "refine";

const MAX_CHAT_MESSAGES = 100;

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

const initialState = {
  step: "form" as BuilderStep,
  projectGoal: "",
  structured: { ...emptyStructured },
  xmlContent: "",
  chatMessages: [] as ChatMessage[],
  isGenerating: false,
  currentPromptId: null as string | null,
};

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ step }),
      setProjectGoal: (projectGoal) => set({ projectGoal }),
      updateStructured: (data) =>
        set((s) => ({ structured: { ...s.structured, ...data } })),
      setXmlContent: (xmlContent) => set({ xmlContent }),
      addChatMessage: (msg) =>
        set((s) => {
          const messages = [...s.chatMessages, msg];
          // Limit chat messages to prevent unbounded growth
          if (messages.length > MAX_CHAT_MESSAGES) {
            return { chatMessages: messages.slice(-MAX_CHAT_MESSAGES) };
          }
          return { chatMessages: messages };
        }),
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
      reset: () => set({ ...initialState, structured: { ...emptyStructured } }),
    }),
    {
      name: "prompt-builder-draft",
      // Only persist draft-relevant fields, not transient state
      partialize: (state) => ({
        step: state.step,
        projectGoal: state.projectGoal,
        structured: state.structured,
        xmlContent: state.xmlContent,
        currentPromptId: state.currentPromptId,
      }),
    }
  )
);
