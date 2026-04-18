import { CONTRACT } from "../db/contract.js";

export function contractToPrompt() {
  return [
    "SCHEMA (resource -> view | default | fields | joins):",
    ...Object.entries(CONTRACT.resources).map(([resName, res]) => {
      const fields = Object.keys(res.fields).join(", ");
      const joins = res.relations
        ? Object.entries(res.relations)
          .map(
            ([relName, rel]) =>
              `${relName}:${rel.localField}->${rel.foreignResource}.${rel.foreignField}`,
          )
          .join(", ")
        : "none";
      const defaults = (res.defaultSelect || []).join(", ") || "none";
      return `- ${resName} -> ${res.view} | default=${defaults} | fields=${fields} | joins=${joins}`;
    }),
    "Chỉ trả JSON plan, không sinh SQL.",
  ].join("\n");
}
