import { PayloadError } from "./model.js";

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(text: string, what: string): Json {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PayloadError(`${what} is not valid JSON`);
  }
  if (!isObject(value)) throw new PayloadError(`${what} must be a JSON object`);
  return value;
}

export function requireString(obj: Json, key: string, what: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") {
    throw new PayloadError(`${what}.${key} must be a non-empty string`);
  }
  return value;
}

export function optionalString(obj: Json, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
