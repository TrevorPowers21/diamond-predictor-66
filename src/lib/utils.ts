import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number with commas for display (e.g. 1234567 → "1,234,567"). */
export function formatWithCommas(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  if (isNaN(num) || num === 0) return "";
  return num.toLocaleString("en-US");
}

/** Strip commas and parse a formatted string back to a number. */
export function parseCommaNumber(input: string): number {
  return Number(input.replace(/,/g, "")) || 0;
}
