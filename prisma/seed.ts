import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

const templates = [
  {
    slug: "code-review",
    name: "Code Review",
    description: "Systematic code review with security, performance, and best practices analysis",
    category: "development",
    isBuiltIn: true,
  },
  {
    slug: "debugging",
    name: "Debugging Assistant",
    description: "Systematic debugging with root cause analysis and fix suggestions",
    category: "development",
    isBuiltIn: true,
  },
  {
    slug: "feature-design",
    name: "Feature Design",
    description: "Design a new feature with architecture, API, and implementation plan",
    category: "architecture",
    isBuiltIn: true,
  },
  {
    slug: "api-design",
    name: "API Design",
    description: "Design RESTful or GraphQL APIs with endpoints, schemas, and error handling",
    category: "architecture",
    isBuiltIn: true,
  },
  {
    slug: "refactoring",
    name: "Refactoring Guide",
    description: "Plan and execute code refactoring with safety checks",
    category: "development",
    isBuiltIn: true,
  },
  {
    slug: "test-generation",
    name: "Test Generation",
    description: "Generate comprehensive test suites with edge cases and mocks",
    category: "development",
    isBuiltIn: true,
  },
  {
    slug: "swarm-orchestration",
    name: "Swarm Orchestration (ruflo)",
    description: "Configure multi-agent swarm for complex AI tasks using ruflo patterns",
    category: "ai-agents",
    isBuiltIn: true,
  },
  {
    slug: "swarm-task-routing",
    name: "Swarm Task Routing",
    description: "Configure intelligent task routing for multi-agent systems",
    category: "ai-agents",
    isBuiltIn: true,
  },
];

async function main() {
  console.log("Seeding templates...");
  for (const t of templates) {
    await prisma.template.upsert({
      where: { slug: t.slug },
      update: t,
      create: { ...t, content: "", structured: "{}" },
    });
  }
  console.log(`Seeded ${templates.length} templates.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
