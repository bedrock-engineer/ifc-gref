import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

export type ViewMode = "2d" | "3d";

interface ViewToggleProps {
  view: ViewMode;
  /**
   * Null: 3D is enabled. Non-null: a user-facing reason shown in the
   * button's tooltip explaining why 3D can't be entered right now (no
   * Helmert params, no resolved CRS, …).
   */
  disabledReason: string | null;
  /** True while the 3D scene is being set up (dynamic import + mesh
   *  extraction). Renders a spinner in place of the "3D" label. */
  isLoading: boolean;
  onChange: (next: ViewMode) => void;
}

const BUTTON =
  "cursor-pointer border-0 px-2.5 py-1.5 text-xs font-semibold outline-none data-selected:bg-[color:var(--accent)] data-selected:text-white data-disabled:cursor-not-allowed data-disabled:opacity-40 data-focus-visible:ring-2 data-focus-visible:ring-slate-500";

// Reserve the natural width of "3D" so swapping in the spinner doesn't
// shift the segmented control. text-xs font-semibold "3D" ≈ 1.4em wide.
const LABEL_MIN_WIDTH = "min-w-[1.4em]";

/**
 * Segmented 2D/3D toggle rendered into the map via `PortalControl`.
 * Visuals mirror MapLibre's built-in controls (white chrome, soft
 * shadow) so it blends with NavigationControl next to it.
 */
export function ViewToggle({
  view,
  disabledReason,
  isLoading,
  onChange,
}: ViewToggleProps) {
  return (
    <ToggleButtonGroup
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={new Set([view])}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next === "2d" || next === "3d") {
          onChange(next);
        }
      }}
      className="flex overflow-hidden rounded bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.1)] [--accent:#0f766e]"
    >
      <ToggleButton id="2d" className={BUTTON}>
        <span className={`inline-block text-center ${LABEL_MIN_WIDTH}`}>
          2D
        </span>
      </ToggleButton>
      <ToggleButton
        id="3d"
        isDisabled={disabledReason !== null}
        aria-label={
          isLoading ? "Loading 3D model" : (disabledReason ?? "3D view")
        }
        className={BUTTON}
      >
        <span
          className={`inline-flex items-center justify-center ${LABEL_MIN_WIDTH}`}
          title={disabledReason ?? ""}
        >
          {isLoading ? (
            <span
              aria-hidden
              className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white"
            />
          ) : (
            "3D"
          )}
        </span>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
