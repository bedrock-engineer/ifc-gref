import { emitLog } from "../../lib/log";

export type IfcSchema = "IFC2X3" | "IFC4" | "IFC4X1" | "IFC4X2" | "IFC4X3";

export function parseSchema(raw: string): IfcSchema {
  // web-ifc returns strings like "IFC2X3", "IFC4", "IFC4X3"
  switch (raw) {
    case "IFC2X3":
    case "IFC4":
    case "IFC4X1":
    case "IFC4X2":
    case "IFC4X3": {
      return raw;
    }
    default: {
      // IFC4X3_ADD2 etc — collapse to IFC4X3 for our purposes
      if (raw.startsWith("IFC4X3")) {
        return "IFC4X3";
      }
      if (raw.startsWith("IFC4")) {
        return "IFC4";
      }
      const message = `Unsupported IFC schema: ${raw}`;
      emitLog({ level: "error", source: "worker", message });
      throw new Error(message);
    }
  }
}
