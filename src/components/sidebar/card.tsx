import type { ReactNode } from "react";

interface CardProps {
  title: string;
  children: ReactNode;
  /** Optional content rendered right-aligned in the header (badge, action). */
  headerAside?: ReactNode;
}

export function Card({ title, children, headerAside }: CardProps) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white px-2 py-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {headerAside}
      </header>
      {children}
    </section>
  );
}
