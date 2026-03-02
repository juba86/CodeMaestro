"use client";

import { useBuilderStore } from "@/stores/builder-store";
import type { SwarmConfig, SwarmAgentRole } from "@/lib/ai/types";
import { Plus, Trash2 } from "lucide-react";

const defaultSwarmConfig: SwarmConfig = {
  topology: "hierarchical",
  agentCount: 4,
  agentRoles: [
    { type: "architect", name: "Architect", description: "System design and planning" },
    { type: "coder", name: "Coder", description: "Implementation" },
    { type: "reviewer", name: "Reviewer", description: "Code review" },
    { type: "tester", name: "Tester", description: "Test generation and validation" },
  ],
  coordinationStrategy: "majority",
  memoryScope: "project",
};

const roleTypes: SwarmAgentRole["type"][] = [
  "researcher", "coder", "analyst", "tester", "architect",
  "reviewer", "optimizer", "documenter", "custom",
];

export function SwarmConfigPanel() {
  const { structured, setSwarmConfig } = useBuilderStore();
  const config = structured.swarmConfig;

  function enable() {
    setSwarmConfig({ ...defaultSwarmConfig });
  }

  function disable() {
    setSwarmConfig(undefined);
  }

  function update(patch: Partial<SwarmConfig>) {
    if (config) setSwarmConfig({ ...config, ...patch });
  }

  function addRole() {
    if (!config) return;
    update({
      agentRoles: [
        ...config.agentRoles,
        { type: "custom", name: "New Agent", description: "" },
      ],
      agentCount: config.agentCount + 1,
    });
  }

  function removeRole(idx: number) {
    if (!config) return;
    const roles = config.agentRoles.filter((_, i) => i !== idx);
    update({ agentRoles: roles, agentCount: Math.max(roles.length, 1) });
  }

  function updateRole(idx: number, patch: Partial<SwarmAgentRole>) {
    if (!config) return;
    const roles = config.agentRoles.map((r, i) =>
      i === idx ? { ...r, ...patch } : r
    );
    update({ agentRoles: roles });
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Swarm / Multi-Agent (ruflo)</h3>
        <button
          onClick={config ? disable : enable}
          className="text-xs px-2 py-1 rounded border border-input hover:bg-accent"
        >
          {config ? "Disable" : "Enable"}
        </button>
      </div>

      {!config && (
        <p className="text-xs text-muted-foreground">
          Enable to add multi-agent swarm orchestration settings to your prompt.
          Supports hierarchical, mesh, ring, and star topologies.
        </p>
      )}

      {config && (
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium">Topology</label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={config.topology}
              onChange={(e) => update({ topology: e.target.value as SwarmConfig["topology"] })}
            >
              <option value="hierarchical">Hierarchical (Queen + Workers)</option>
              <option value="mesh">Mesh (Peer-to-Peer)</option>
              <option value="ring">Ring (Circular)</option>
              <option value="star">Star (Hub-based)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium">Coordination</label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={config.coordinationStrategy}
              onChange={(e) =>
                update({ coordinationStrategy: e.target.value as SwarmConfig["coordinationStrategy"] })
              }
            >
              <option value="majority">Majority Voting</option>
              <option value="weighted">Weighted (Queen 3x)</option>
              <option value="byzantine">Byzantine Fault Tolerance</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium">Memory Scope</label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={config.memoryScope}
              onChange={(e) => update({ memoryScope: e.target.value as SwarmConfig["memoryScope"] })}
            >
              <option value="project">Project-level</option>
              <option value="local">Local</option>
              <option value="user">User-scoped</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium">
                Agent Roles ({config.agentRoles.length})
              </label>
              <button onClick={addRole} className="text-xs flex items-center gap-1 hover:text-primary">
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {config.agentRoles.map((role, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <select
                    className="rounded border border-input bg-background px-1 py-1 text-xs w-24"
                    value={role.type}
                    onChange={(e) => updateRole(idx, { type: e.target.value as SwarmAgentRole["type"] })}
                  >
                    {roleTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
                    value={role.name}
                    onChange={(e) => updateRole(idx, { name: e.target.value })}
                    placeholder="Name"
                  />
                  <button
                    onClick={() => removeRole(idx)}
                    className="p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
