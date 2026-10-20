import { decimal } from "../../src/values/index.js";

export type Normalization = { readonly ok: true; readonly canonical: string; readonly unit: string } | { readonly ok: false; readonly reason: string };
/** String/decimal arithmetic only. This adapter never edits imported JSON. */
export function normalizePersonalInput(raw: string, kind: "money" | "decimal" | "percent" | "date" | "month", currency?: string): Normalization {
  let text = raw.trim();
  const fail = (reason: string): Normalization => ({ ok: false, reason });
  if (kind === "date" || kind === "month") {
    if (kind === "month") {
      const named = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i.exec(text);
      if (named) text = `${named[2]}-${String(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(named[1]!.toLowerCase()) + 1).padStart(2, "0")}`;
      const numeric = /^(\d{1,2})[/-](\d{4})$/.exec(text);
      if (numeric) text = `${numeric[2]}-${numeric[1]!.padStart(2, "0")}`;
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? { ok: true, canonical: text, unit: "calendar month" } : fail("Use YYYY-MM, MM/YYYY or a full month name and year.");
    }
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (local) {
      const a = Number(local[1]), b = Number(local[2]);
      if (a <= 12 && b <= 12 && a !== b) return fail("Ambiguous day/month order. Use YYYY-MM-DD.");
      const month = a > 12 ? b : a, day = a > 12 ? a : b;
      text = `${local[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fail("Use an unambiguous full date, YYYY-MM-DD.");
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? { ok: true, canonical: text, unit: "date" } : fail("This calendar date does not exist.");
  }
  if (kind === "percent" && text.endsWith("%")) text = text.slice(0, -1).trim();
  if (kind === "money") {
    const marker = /^(USD|EUR|GBP|\$|€|£)\s*/.exec(text);
    if (marker) {
      const represented = ({ "$": "USD", "€": "EUR", "£": "GBP" } as Record<string, string>)[marker[1]!] ?? marker[1];
      if (!currency || represented !== currency) return fail("The currency must match the field's explicit currency.");
      text = text.slice(marker[0].length);
    }
  }
  if (text.includes(",")) {
    if (!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) return fail("Ambiguous grouping or decimal separator. Use a decimal point and groups of three digits.");
    text = text.replaceAll(",", "");
  }
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return fail("Use one exact decimal; mixed units and scientific notation are unsupported.");
  try {
    const value = decimal(text);
    if (kind === "money" && !value.fitsScale(2)) return fail("Enter exact cents; extra precision cannot be silently rounded.");
    return { ok: true, canonical: text.startsWith("+") ? text.slice(1) : text, unit: kind === "percent" ? "% (percentage points; canonical rate conversion is unchanged)" : kind === "money" ? currency ?? "recorded currency" : "recorded decimal unit" };
  } catch { return fail("This amount cannot be represented exactly."); }
}
