import { Button } from "react-aria-components";

interface ZoomToModelProps {
  isDisabled: boolean;
  onPress: () => void;
}

/**
 * Re-frames the map around the IFC footprint / reference point. Same
 * framing logic as the initial load — useful after the user has panned
 * or zoomed away while editing parameters.
 */
export function ZoomToModel({ isDisabled, onPress }: ZoomToModelProps) {
  return (
    <Button
      onPress={onPress}
      isDisabled={isDisabled}
      aria-label="Zoom to model"
      className="flex h-[29px] w-[29px] cursor-pointer items-center justify-center rounded bg-white text-slate-700 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] outline-none data-hovered:bg-slate-100 data-disabled:cursor-not-allowed data-disabled:opacity-40 data-focus-visible:ring-2 data-focus-visible:ring-slate-500"
    >
      <span title="Zoom to model">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 5 V2 H5" />
          <path d="M11 2 H14 V5" />
          <path d="M14 11 V14 H11" />
          <path d="M5 14 H2 V11" />
          <rect x="6" y="6" width="4" height="4" />
        </svg>
      </span>
    </Button>
  );
}
