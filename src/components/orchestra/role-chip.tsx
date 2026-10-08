import * as React from "react";
import type { LucideProps } from "lucide-react";
import type { OrchestraConfig } from "@/lib/assistant/orchestra-types";
import { cn } from "@/components/ui/cn";
import { roleIcon } from "./derive";

/** The §6.3 icon of a role (matched by id, then name). Decorative unless labelled. */
export function RoleIcon({ of, ...props }: { of: { id?: string | null; name?: string | null } | null | undefined } & Omit<LucideProps, "role"> & { role?: never }) {
  return React.createElement(roleIcon(of), { "aria-hidden": true, ...props });
}

export interface RoleChipProps {
  roleId?: string;
  /** Fallback name (e.g. from a plan event) when the role is not in `config`. */
  name?: string;
  /** When given, the role's current name and enabled state come from here. */
  config?: OrchestraConfig | null;
  size?: "sm" | "md";
  /** Muted text after the name inside the chip, e.g. the model. */
  detail?: React.ReactNode;
  className?: string;
}

/** Pill with the role's icon and name (§6.3 icon table). Disabled roles get a dashed, muted look and say „aus" to screen readers. */
export function RoleChip({ roleId, name, config, size = "sm", detail, className }: RoleChipProps) {
  const role = roleId && config ? config.roles.find((r) => r.id === roleId) : undefined;
  const label = role?.name.trim() || name?.trim() || roleId || "Rolle";
  const off = role ? !role.enabled : false;
  return (
    <span
      data-slot="role-chip"
      className={cn(
        "inline-flex min-w-0 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border-strong bg-surface-2 font-medium leading-none text-foreground",
        size === "sm" ? "h-5 px-2 text-xs [&_svg]:size-3" : "h-6 px-2.5 text-xs [&_svg]:size-3.5",
        off && "border-dashed text-muted-foreground",
        className,
      )}
    >
      <RoleIcon of={{ id: role?.id ?? roleId, name: label }} className="shrink-0 text-subtle-foreground" />
      <span className="truncate">{label}</span>
      {detail ? <span className="truncate font-normal text-muted-foreground">· {detail}</span> : null}
      {off ? <span className="sr-only"> (aus)</span> : null}
    </span>
  );
}
