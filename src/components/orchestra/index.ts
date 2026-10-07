// Public surface of the orchestra package (DESIGN.md §9.2). Config types come
// from @/lib/assistant/orchestra-types.

export { useOrchestraConfig, type UseOrchestraConfigResult } from "./use-orchestra-config";
export { OrchestraLiveList, type OrchestraLiveListProps } from "./orchestra-live-list";
export { OrchestraSummaryCard, type OrchestraSummaryCardProps } from "./orchestra-summary-card";
export { RoleChip, RoleIcon, type RoleChipProps } from "./role-chip";
export {
  roleIcon,
  presetLabel,
  workerLabel,
  costHint,
  columnOf,
  COLUMN_LABEL,
  roleAssignment,
  conductorAssignment,
  type OrchestraColumn,
} from "./derive";
export {
  reduceOrchestraLive,
  deriveLiveView,
  EMPTY_ORCHESTRA_LIVE,
  type OrchestraLiveState,
  type OrchestraLiveSubtask,
  type OrchestraLiveEvent,
  type ConductorPhase,
  type SubtaskStatus,
} from "./live";
