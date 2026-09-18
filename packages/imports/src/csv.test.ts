import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "./csv.js";

describe("parseCsv", () => {
  it("splits plain fields", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas and newlines inside quoted fields", () => {
    expect(parseCsv('name,note\n"Acme, Inc.","line one\nline two"\n')).toEqual([
      ["name", "note"],
      ["Acme, Inc.", "line one\nline two"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('note\n"say ""hi"""\n')).toEqual([["note"], ['say "hi"']]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM from the first field", () => {
    expect(parseCsv("﻿a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ignores trailing blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvRecords", () => {
  it("keys rows by lower-cased header", () => {
    expect(parseCsvRecords("SKU,Name\nA1,Widget\n")).toEqual([{ sku: "A1", name: "Widget" }]);
  });

  it("returns an empty array for an empty file", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });
});
