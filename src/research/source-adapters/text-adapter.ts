export async function resolveTextInput(
  value: string,
  explicitTitle?: string,
): Promise<{ title: string; text: string; notes?: string }> {
  const previewTitle = truncate(singleLine(value), 80);
  const title = explicitTitle ?? (previewTitle || "Manual text input");
  return { title, text: value, notes: `manual text (${value.length} chars)` };
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}...`;
}
