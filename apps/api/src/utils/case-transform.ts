type AnyRecord = Record<string, unknown>;

function snakeToCamelStr(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelToSnakeStr(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function snakeToCamel<T = AnyRecord>(obj: AnyRecord): T {
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamelStr(key);
    if (value !== null && typeof value === "object" && !Array.isArray(value) && value instanceof Date === false) {
      result[camelKey] = snakeToCamel(value as AnyRecord);
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? snakeToCamel(item as AnyRecord)
          : item,
      );
    } else {
      result[camelKey] = value;
    }
  }
  return result as T;
}

export function camelToSnake<T = AnyRecord>(obj: AnyRecord): T {
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    result[camelToSnakeStr(key)] = value;
  }
  return result as T;
}

export function snakeToCamelArray<T = AnyRecord>(arr: AnyRecord[]): T[] {
  return arr.map((item) => snakeToCamel<T>(item));
}
