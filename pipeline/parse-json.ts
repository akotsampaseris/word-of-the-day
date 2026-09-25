/**
 * Defensive parsing of a model's reply. We ask for bare JSON, but models
 * sometimes wrap it in ```json fences or add a sentence before or after,
 * so we try progressively looser readings before giving up.
 */

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export function parseModelJson(raw: string): ParseResult {
  let text = raw.trim();

  // 1. Strip a surrounding markdown code fence, if present.
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(text);
  if (fenced) text = fenced[1]!.trim();

  // 2. Try the text as-is.
  const direct = tryParse(text);
  if (direct.ok) return direct;

  // 3. Fall back to the outermost {...}, in case of chatter around the object.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const inner = tryParse(text.slice(start, end + 1));
    if (inner.ok) return inner;
  }

  return {
    ok: false,
    error: `response: was not valid JSON (${direct.error}). Reply with a single JSON object and nothing else.`,
  };
}

function tryParse(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
