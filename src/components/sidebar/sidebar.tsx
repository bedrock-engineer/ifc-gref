import type { ReactNode } from "react";

const style = { gridArea: "sidebar" };

interface SidebarProps {
  children: ReactNode;
  saveCard: ReactNode;
}

export function Sidebar({ saveCard, children }: SidebarProps) {
  return (
    <aside
      style={style}
      className="flex flex-col overflow-hidden h-full border-r border-slate-200 bg-slate-50
      "
    >
      <div className="space-y-3 min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain">
        {children}
      </div>

      {saveCard}
    </aside>
  );
}
