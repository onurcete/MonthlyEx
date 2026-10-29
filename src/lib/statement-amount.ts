// Parse the numeric token read from a statement without floating point rounding.
// Ambiguous formats (e.g. 1.234 without decimal places) must be reviewed.
export function parseStatementAmount(raw: string): number | null {
  const text = raw.trim().replace(/^[+-]/, "").replace(/[+-]$/, "");
  const turkish = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/.exec(text);
  const decimal = /^(\d+)\.(\d{2})$/.exec(text);
  const match = turkish ?? decimal;
  let cents: number;
  if (match) cents = Number(match[1].replaceAll(".", "")) * 100 + Number(match[2]);
  else if (/^\d+$/.test(text)) cents = Number(text) * 100;
  else return null;
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000000 ? cents : null;
}
