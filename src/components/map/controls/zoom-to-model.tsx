import { Button } from "react-aria-components";
import { EnterFullScreenIcon } from "@radix-ui/react-icons";

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
        <EnterFullScreenIcon />
      </span>
    </Button>
  );
}
