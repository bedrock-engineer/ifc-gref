import type { ReactNode } from "react";
import { CardHelpButton } from "./help-popover";

interface CardProps {
  title: string;
  children: ReactNode;
  /** Optional content rendered right-aligned in the header (badge, action). */
  headerAside?: ReactNode;
  /**
   * If provided, a `?` button is rendered in the header that opens a
   * popover with this content. Keep it short — a paragraph or a few
   * bullets; long-form docs belong in the help drawer.
   */
  help?: ReactNode;
}

export function Card({ title, children, headerAside, help }: CardProps) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <div className="flex items-center gap-1">
          {help ? (
            <CardHelpButton label={`Help: ${title}`}>{help}</CardHelpButton>
          ) : null}

          {headerAside}
        </div>
      </header>
      {children}
    </section>
  );
}
