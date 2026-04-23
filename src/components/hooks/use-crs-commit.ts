import { useReducer, useRef } from "react";
import type { Key } from "react-aria-components";
import { type CrsError, lookupCrs } from "../../lib/crs";

type Status =
  | { kind: "idle" }
  | { kind: "checking"; code: number }
  | { kind: "rejected"; message: string };

interface State {
  input: string;
  lastExternalCode: string;
  committedManually: boolean;
  status: Status;
}

type Action =
  | { type: "external-synced"; code: string }
  | { type: "input-changed"; value: string }
  | { type: "revert" }
  | { type: "syntax-rejected" }
  | { type: "commit-started"; code: number }
  | { type: "commit-rejected"; message: string }
  | { type: "commit-accepted"; code: string };

function initState(code: string): State {
  return {
    input: code,
    lastExternalCode: code,
    committedManually: false,
    status: { kind: "idle" },
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "external-synced": {
      return {
        input: action.code,
        lastExternalCode: action.code,
        committedManually: false,
        status: { kind: "idle" },
      };
    }
    case "input-changed": {
      return {
        ...state,
        input: action.value,
        status:
          state.status.kind === "rejected" ? { kind: "idle" } : state.status,
      };
    }
    case "revert": {
      return {
        ...state,
        input: state.lastExternalCode,
        status: { kind: "idle" },
      };
    }
    case "syntax-rejected": {
      return {
        ...state,
        input: state.lastExternalCode,
        status: { kind: "rejected", message: "Enter a numeric EPSG code." },
      };
    }
    case "commit-started": {
      return { ...state, status: { kind: "checking", code: action.code } };
    }
    case "commit-rejected": {
      return {
        ...state,
        input: state.lastExternalCode,
        status: { kind: "rejected", message: action.message },
      };
    }
    case "commit-accepted": {
      return {
        ...state,
        input: action.code,
        committedManually: true,
        status: { kind: "idle" },
      };
    }
  }
}

function rejectionMessage(code: number, kind: CrsError["kind"]): string {
  if (kind === "not-found") {
    return `EPSG:${code} not found.`;
  }
  return `Could not resolve EPSG:${code}.`;
}

export interface UseCrsCommit {
  input: string;
  status: Status;
  committedManually: boolean;
  onInputChange: (value: string) => void;
  onCommit: (value: string) => void;
  onSelect: (key: Key | null) => void;
}

/**
 * Owns the local text-input state, async lookup, and stale-suppression for
 * the target-CRS combobox. Splits two timelines:
 *
 *   - external `epsgCode` prop — the committed, validated code in Workspace
 *   - local `input` — what the user has typed but not yet committed
 *
 * A committed code propagates up via `onChange`; typing only updates local
 * state. The reducer's `external-synced` case snaps local state back when
 * Workspace changes the code (file load, solver result).
 */
export function useCrsCommit(
  epsgCode: string,
  onChange: (code: string) => void,
): UseCrsCommit {
  const [state, dispatch] = useReducer(reducer, epsgCode, initState);
  const inflightRef = useRef<number | null>(null);

  // Adjust state during render when the external epsgCode changes (file load,
  // solver result). https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (epsgCode !== state.lastExternalCode) {
    dispatch({ type: "external-synced", code: epsgCode });
  }

  function onInputChange(value: string) {
    dispatch({ type: "input-changed", value });
  }

  async function commit(rawValue: string) {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0 || trimmed === epsgCode) {
      dispatch({ type: "revert" });
      return;
    }
    
    if (!/^\d+$/.test(trimmed)) {
      dispatch({ type: "syntax-rejected" });
      return;
    }

    const code = Number.parseInt(trimmed, 10);
    dispatch({ type: "commit-started", code });
    inflightRef.current = code;
    const result = await lookupCrs(code);
    // Ignore stale resolutions from a superseded in-flight lookup.
    if (inflightRef.current !== code) {
      return;
    }

    if (result.isErr()) {
      dispatch({
        type: "commit-rejected",
        message: rejectionMessage(code, result.error.kind),
      });
      return;
    }

    dispatch({ type: "commit-accepted", code: trimmed });
    
    if (trimmed !== epsgCode) {
      onChange(trimmed);
    }
  }

  function onCommit(value: string) {
    void commit(value);
  }

  function onSelect(key: Key | null) {
    if (key === null) {
      return;
    }
    const code = String(key);
    // Items all come from the manifest, which is curated to projected /
    // compound CRS at build time — selection is trusted, no round-trip
    // through lookupCrs.
    dispatch({ type: "commit-accepted", code });
    if (code !== epsgCode) {
      onChange(code);
    }
  }

  return {
    input: state.input,
    status: state.status,
    committedManually: state.committedManually,
    onInputChange,
    onCommit,
    onSelect,
  };
}
