import { useReducer } from "react";
import type { Key } from "react-aria-components";

interface State {
  input: string;
  /** Last value propagated up via `onCommit`. Initialised from `initialCode`
   * since that's already what the parent has. Used to skip duplicate commits
   * (most often a blur where the input matches the current value) and as
   * the revert target when the user types non-numeric input. */
  lastCommitted: string;
  syntaxError: string | null;
}

type Action =
  | { type: "input-changed"; value: string }
  | { type: "syntax-rejected" }
  | { type: "commit"; code: string };

function initState(code: string): State {
  return { input: code, lastCommitted: code, syntaxError: null };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "input-changed": {
      return { ...state, input: action.value, syntaxError: null };
    }
    case "syntax-rejected": {
      return {
        ...state,
        input: state.lastCommitted,
        syntaxError: "Enter a numeric EPSG code.",
      };
    }
    case "commit": {
      return {
        input: action.code,
        lastCommitted: action.code,
        syntaxError: null,
      };
    }
  }
}

export interface UseCrsCommit {
  input: string;
  syntaxError: string | null;
  onInputChange: (value: string) => void;
  onCommit: (value: string) => void;
  onSelect: (key: Key | null) => void;
}

/**
 * Owns the local text-input state for the target-CRS combobox. `initialCode`
 * seeds the reducer once on mount; later changes to the prop are *not*
 * tracked here. The parent (TargetCrsCard) forces a fresh mount via
 * `key={epsgCode}` whenever the external value changes — that's the only
 * "external sync" we need, and it removes a whole class of two-timeline
 * sync bugs (notably the latent one where `committedManually` was reset
 * immediately after every successful manual commit).
 *
 * On commit (Enter / blur / dropdown select) a numeric input propagates
 * up via `onCommit`; non-digit input is rejected locally. Resolution
 * feedback is *not* this hook's job — `useCrsResolution(epsgCode)` runs
 * at the workspace level and the card renders its `CrsLookupState`.
 */
export function useCrsCommit(
  initialCode: string,
  onCommit: (code: string) => void,
): UseCrsCommit {
  const [state, dispatch] = useReducer(reducer, initialCode, initState);

  function onInputChange(value: string) {
    dispatch({ type: "input-changed", value });
  }

  function handleCommit(value: string) {
    const trimmed = value.trim();
    if (trimmed === state.lastCommitted) {
      return;
    }
    if (trimmed.length === 0) {
      dispatch({ type: "input-changed", value: state.lastCommitted });
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      dispatch({ type: "syntax-rejected" });
      return;
    }
    dispatch({ type: "commit", code: trimmed });
    onCommit(trimmed);
  }

  function onSelect(key: Key | null) {
    if (key === null) {
      return;
    }
    const code = String(key);
    if (code === state.lastCommitted) {
      return;
    }
    dispatch({ type: "commit", code });
    onCommit(code);
  }

  return {
    input: state.input,
    syntaxError: state.syntaxError,
    onInputChange,
    onCommit: handleCommit,
    onSelect,
  };
}
