import Link from "next/link";
import { Hammer, Library, FlaskConical, LayoutTemplate, Gamepad2 } from "lucide-react";

const features = [
  {
    href: "/builder",
    icon: Hammer,
    title: "Prompt Builder",
    description: "Create structured CoT prompts with AI assistance and XML tags",
  },
  {
    href: "/library",
    icon: Library,
    title: "Prompt Library",
    description: "Manage, version, search and organize your saved prompts",
  },
  {
    href: "/templates",
    icon: LayoutTemplate,
    title: "Templates",
    description: "Start from pre-built templates for common AI tasks and Swarm configs",
  },
  {
    href: "/playground",
    icon: FlaskConical,
    title: "Playground",
    description: "Test prompts live against Claude or Gemini and compare results",
  },
  {
    href: "/game",
    icon: Gamepad2,
    title: "GME Chart Runner",
    description: "A jump-and-run game on the GME stock chart.",
  },
];

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">PromptBuilder</h1>
        <p className="text-muted-foreground">
          Build structured Chain-of-Thought prompts with XML tags for AI development.
          Supports multi-agent Swarm orchestration via ruflo.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {features.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="group flex gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors"
          >
            <div className="shrink-0 p-2 rounded-md bg-primary/10 text-primary group-hover:bg-primary/20">
              <Icon size={24} />
            </div>
            <div>
              <h2 className="font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
