/**
 * What an uploaded image really is. The browser's Content-Type is whatever
 * the sender chose to write, so uploads are also checked by their first bytes
 * — a file that says image/png but is HTML or a script is refused.
 */

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.length > 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/svg+xml': (b) => isSafeSvg(b),
};

/** True when the bytes match the declared image type. */
export function contentMatchesType(buffer: Buffer, mimetype: string): boolean {
  return SIGNATURES[mimetype]?.(buffer) ?? false;
}

/**
 * An SVG is a document that can run script when opened directly. Logos are
 * shown through <img> (which never runs it), but a stored file can also be
 * opened on its own, so anything active is refused outright: scripts, event
 * handlers, embedded HTML, and references to anything outside the file.
 */
function isSafeSvg(buffer: Buffer): boolean {
  const text = buffer.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) return false;
  const forbidden = [
    /<script/i,
    /\son[a-z]+\s*=/i,
    /<foreignObject/i,
    /<iframe|<embed|<object/i,
    /javascript:/i,
    /<!ENTITY/i,
    /(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)/i,
  ];
  return !forbidden.some((pattern) => pattern.test(text));
}
