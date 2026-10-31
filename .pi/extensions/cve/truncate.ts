// Text truncation helpers for diff output with per-item and total budgets.

/** Cuts text to max characters and appends a marker stating how much was dropped. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[... truncated ${text.length - max} chars]`;
}

/** Truncates each item to perItem characters, and gives later items less once the total budget is spent. */
export function applyBudget(items: string[], perItem: number, total: number): string[] {
  let left = total;
  return items.map((item) => {
    const cap = Math.max(0, Math.min(perItem, left));
    left -= Math.min(item.length, cap);
    return truncate(item, cap);
  });
}
