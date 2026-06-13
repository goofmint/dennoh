import { uuidv7 } from "uuidv7";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateId(): string {
  return uuidv7();
}

export function isValidUuid(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}
