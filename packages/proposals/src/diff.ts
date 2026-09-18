/**
 * A Business Diff is the human-readable "what will change" view a user
 * approves before a critical write executes (docs/mvp/09-proposals-and-governance.md).
 * Domain packages (invoices, pricing, inventory, customers) build these;
 * this package only renders and persists them, so no business logic about
 * *what* a diff should say lives here (non-negotiable #9 territory, applied
 * broadly rather than just to MCP).
 */
export interface BusinessDiffChange {
  label: string;
  before?: string;
  after?: string;
}

export interface BusinessDiffSection {
  heading?: string;
  lines?: string[];
  changes?: BusinessDiffChange[];
}

export interface BusinessDiff {
  title: string;
  sections: BusinessDiffSection[];
}

/** Renders the same plain text-block style used throughout the spec's examples. */
export function renderDiffText(diff: BusinessDiff): string {
  const out: string[] = [diff.title, ""];
  for (const section of diff.sections) {
    if (section.heading) out.push(section.heading);
    for (const line of section.lines ?? []) out.push(line);
    for (const change of section.changes ?? []) {
      if (change.before !== undefined && change.after !== undefined) {
        out.push(`${change.label}: ${change.before} → ${change.after}`);
      } else {
        out.push(change.label);
      }
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
