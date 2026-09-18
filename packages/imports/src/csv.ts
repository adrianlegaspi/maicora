/**
 * A CSV reader, not a CSV library. It handles the parts real spreadsheet
 * exports actually use - quoted fields, embedded commas and newlines, doubled
 * quotes, CRLF, a UTF-8 BOM - and nothing else. Adding a dependency for
 * thirty lines that three import screens call would cost more than it saves.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const input = text.replace(/^﻿/, "");

  const endField = () => {
    row.push(field.trim());
    field = "";
    started = false;
  };
  const endRow = () => {
    endField();
    // Trailing newlines and blank lines are not empty records.
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !started) {
      quoted = true;
      started = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char !== "\r") {
      field += char;
      started = true;
    }
  }

  if (field !== "" || row.length) endRow();
  return rows;
}

/** Rows keyed by lower-cased header, so `SKU`, `sku` and ` Sku ` all work. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((column) => column.trim().toLowerCase());

  return rows.map((row) =>
    Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])),
  );
}
