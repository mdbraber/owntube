export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** HLS quoted-string attributes may not contain a double quote or line break. */
export function hlsQuoted(s: string): string {
  return `"${s.replace(/["\r\n]/g, "'")}"`;
}
