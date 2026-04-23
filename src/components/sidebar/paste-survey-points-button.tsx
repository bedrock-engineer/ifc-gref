import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Label,
  Modal,
  ModalOverlay,
  TextArea,
  TextField,
} from "react-aria-components";
import {
  parseSurveyPointPaste,
  type ParsedPointRow,
  type PasteParseError,
  type PasteParseSuccess,
  type RowIssue,
} from "../../lib/survey-point-paste";

interface PasteSurveyPointsButtonProps {
  currentPointCount: number;
  onReplace: (rows: Array<ParsedPointRow>) => void;
}

/**
 * Icon button + modal dialog for bulk-pasting survey points from the
 * clipboard. Replaces the entire points grid on commit — the row-level
 * preview is the safety net against unintended overwrites.
 */
export function PasteSurveyPointsButton({
  currentPointCount,
  onReplace,
}: PasteSurveyPointsButtonProps) {
  return (
    <DialogTrigger>
      <Button
        aria-label="Paste survey points from clipboard"
        className="inline-flex items-center justify-center rounded border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        <ClipboardIcon />
      </Button>

      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      >
        <Modal className="w-full max-w-xl rounded-lg bg-white shadow-xl outline-none">
          <Dialog className="space-y-3 p-4 outline-none">
            {({ close }) => (
              <PasteDialogBody
                currentPointCount={currentPointCount}
                onReplace={(rows) => {
                  onReplace(rows);
                  close();
                }}
                onCancel={close}
              />
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

interface PasteDialogBodyProps {
  currentPointCount: number;
  onReplace: (rows: Array<ParsedPointRow>) => void;
  onCancel: () => void;
}

function PasteDialogBody({
  currentPointCount,
  onReplace,
  onCancel,
}: PasteDialogBodyProps) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const parsed = trimmed.length === 0 ? null : parseSurveyPointPaste(text);

  const rows = parsed?.isOk() ? parsed.value.rows : [];
  const canCommit = rows.length > 0;

  return (
    <>
      <Heading slot="title" className="text-base font-semibold text-slate-900">
        Paste survey points
      </Heading>

      <p className="text-xs text-slate-600">
        Six values per row: engineering <span className="font-mono">X Y Z</span>
        , then projected <span className="font-mono">X Y Z</span>. Tab, comma,
        semicolon, or whitespace between values. Decimal separator must be{" "}
        <span className="font-mono">.</span>
      </p>

      <TextField value={text} onChange={setText}>
        <Label className="block text-xs font-medium text-slate-600">
          Clipboard
        </Label>

        <TextArea
          rows={6}
          placeholder={EXAMPLE_PLACEHOLDER}
          className="mt-1 block w-full resize-y rounded border border-slate-300 bg-white p-2 font-mono text-xs text-slate-900 outline-none focus:border-slate-500"
        />
      </TextField>

      <PasteParseStatus parsed={parsed} currentPointCount={currentPointCount} />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          onPress={onCancel}
          className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          Cancel
        </Button>

        <Button
          isDisabled={!canCommit}
          onPress={() => {
            if (parsed?.isOk()) {
              onReplace(parsed.value.rows);
            }
          }}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50"
        >
          {canCommit
            ? `Replace with ${rows.length} ${rows.length === 1 ? "point" : "points"}`
            : "Replace"}
        </Button>
      </div>
    </>
  );
}

interface PasteParseStatusProps {
  parsed: ReturnType<typeof parseSurveyPointPaste> | null;
  currentPointCount: number;
}

function PasteParseStatus({
  parsed,
  currentPointCount,
}: PasteParseStatusProps) {
  if (parsed === null) {
    return (
      <p className="text-xs text-slate-400">
        Waiting for paste — example two rows shown above.
      </p>
    );
  }

  if (parsed.isErr()) {
    return <ErrorSummary error={parsed.error} />;
  }

  return (
    <SuccessSummary
      success={parsed.value}
      currentPointCount={currentPointCount}
    />
  );
}

interface SuccessSummaryProps {
  success: PasteParseSuccess;
  currentPointCount: number;
}

function SuccessSummary({ success, currentPointCount }: SuccessSummaryProps) {
  const { rows, issues, skippedHeader } = success;
  const pointWord = rows.length === 1 ? "point" : "points";
  const currentWord = currentPointCount === 1 ? "point" : "points";

  return (
    <div className="space-y-1 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs">
      <p className="font-medium text-emerald-800">
        {rows.length} {pointWord} parsed. Will replace current{" "}
        {currentPointCount} {currentWord}.
      </p>

      {skippedHeader && (
        <p className="text-emerald-700">
          Line 1 looked like a header — skipped.
        </p>
      )}
      {issues.length > 0 && <IssueList issues={issues} />}
    </div>
  );
}

interface ErrorSummaryProps {
  error: PasteParseError;
}

function ErrorSummary({ error }: ErrorSummaryProps) {
  return (
    <div className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
      <p className="font-medium text-amber-800">
        {error.kind === "empty"
          ? "No data rows to import."
          : "No rows could be parsed."}
      </p>
      
      {error.issues.length > 0 && <IssueList issues={error.issues} />}
    </div>
  );
}

interface IssueListProps {
  issues: Array<RowIssue>;
}

function IssueList({ issues }: IssueListProps) {
  return (
    <ul className="space-y-0.5 text-amber-700">
      {issues.map((issue) => (
        <li key={issue.lineNumber}>
          Line {issue.lineNumber} — {issue.reason}
        </li>
      ))}
    </ul>
  );
}

function ClipboardIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

const EXAMPLE_PLACEHOLDER = `0.000\t0.000\t0.000\t90809.430\t435447.717\t3.514
40.000\t0.000\t0.000\t90849.209\t435451.729\t3.494
40.000\t25.000\t0.000\t90846.740\t435476.596\t3.521`;
