"use client";

import { PushSettingsCard } from "@/components/push-toggle";
import { SectionHeader, SettingsCard } from "./settings-ui";

export function NotificationsSection() {
  return (
    <div>
      <SectionHeader
        title="Benachrichtigungen"
        description="Benachrichtigungen führen direkt zur Freigabe. Entscheiden kannst du nur in der App – mit Blick auf den Diff."
      />
      <SettingsCard>
        <PushSettingsCard />
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground md:text-ui">
          Du bekommst eine Benachrichtigung, wenn ein Lauf eine Freigabe oder Antwort braucht oder fertig ist und gerade
          kein Fenster mit der Session offen ist. Gilt nur für dieses Gerät; aktiviere Push auf jedem Gerät, das
          benachrichtigt werden soll.
        </p>
      </SettingsCard>
    </div>
  );
}
