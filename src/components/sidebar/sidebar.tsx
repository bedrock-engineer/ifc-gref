import type { ReactNode } from "react";

interface SidebarProps {
  children: ReactNode;
  saveCard: ReactNode;
}

export function Sidebar({ saveCard, children }: SidebarProps) {
  return (
    <aside className="flex w-105 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {children}
      </div>

      {saveCard}
    </aside>
  );
}
