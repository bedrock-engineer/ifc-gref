import { FileTrigger } from "react-aria-components";
import { Button } from "./button";

interface HeaderProps {
  filename: string | null;
  onFile: (file: File) => void;
}

export function Header({ filename, onFile }: HeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          IFC Georeferencer
        </h1>
        {filename && <p className="text-xs text-slate-500">{filename}</p>}
      </div>

      <FileTrigger
        acceptedFileTypes={[".ifc"]}
        onSelect={(files) => {
          const f = files ? files[0] : undefined;
          if (f) {
            onFile(f);
          }
        }}
      >
        <Button variant="secondary" size="md">
          {filename ? "Load another file" : "Load file"}
        </Button>
      </FileTrigger>
      
    </header>
  );
}
