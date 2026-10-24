type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const object = (v: Json): { [key: string]: Json } => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected wire object");
  return v;
};
export const wireItems = (v: Json): Json[] => {
  const value = object(v).value;
  if (!Array.isArray(value)) throw new Error("Expected wire items");
  return value;
};
export const wireField = (v: Json, key: string): Json => {
  for (const entry of wireItems(v)) if (Array.isArray(entry) && entry[0] === key && entry[1] !== undefined) return entry[1];
  throw new Error(`Missing wire field ${key}`);
};
export const replaceWireField = (v: Json, key: string, replacement: Json) => {
  for (const entry of wireItems(v)) if (Array.isArray(entry) && entry[0] === key) { entry[1] = replacement; return; }
  throw new Error(`Missing wire field ${key}`);
};
export const expandedWire = (encoded: string): Json => {
  const definitions = new Map<number, Json>();
  const expand = (v: Json): Json => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(expand);
    if (v.kind === "definition") {
      if (!Array.isArray(v.value) || typeof v.value[0] !== "number" || v.value[1] === undefined) throw new Error("Invalid definition");
      const result = expand(v.value[1]); definitions.set(v.value[0], result); return result;
    }
    if (v.kind === "reference") {
      if (typeof v.value !== "number" || !definitions.has(v.value)) throw new Error("Invalid reference");
      return definitions.get(v.value)!;
    }
    return Object.fromEntries(Object.entries(v).map(([key, value]) => [key, expand(value)]));
  };
  return JSON.parse(JSON.stringify(expand(JSON.parse(encoded))));
};
