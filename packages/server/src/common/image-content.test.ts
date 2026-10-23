/**
 * Uploaded images are judged by their bytes, not by the type the sender
 * claimed — and an SVG may not carry anything that runs.
 */
import { describe, expect, it } from 'vitest';
import { contentMatchesType } from './image-content.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const svg = (inner: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`);

describe('contentMatchesType', () => {
  it('accepts real PNG, JPEG and WEBP bytes for their own type', () => {
    expect(contentMatchesType(PNG, 'image/png')).toBe(true);
    expect(contentMatchesType(JPEG, 'image/jpeg')).toBe(true);
    expect(contentMatchesType(WEBP, 'image/webp')).toBe(true);
  });

  it('refuses a file whose bytes are not the type it claims', () => {
    expect(contentMatchesType(Buffer.from('<html><script>alert(1)</script>'), 'image/png')).toBe(
      false,
    );
    expect(contentMatchesType(PNG, 'image/jpeg')).toBe(false);
    expect(contentMatchesType(Buffer.alloc(0), 'image/png')).toBe(false);
    expect(contentMatchesType(PNG, 'text/html')).toBe(false);
  });

  it('accepts a plain SVG drawing', () => {
    expect(
      contentMatchesType(svg('<circle cx="5" cy="5" r="4" fill="#123456"/>'), 'image/svg+xml'),
    ).toBe(true);
    expect(contentMatchesType(svg('<use href="#shape"/>'), 'image/svg+xml')).toBe(true);
  });

  it('refuses an SVG with scripts, event handlers, embedded HTML or outside links', () => {
    for (const inner of [
      '<script>alert(1)</script>',
      '<rect onload="alert(1)"/>',
      '<foreignObject><iframe src="https://evil.example"/></foreignObject>',
      '<a href="javascript:alert(1)"><rect/></a>',
      '<image href="https://evil.example/track.png"/>',
      '<use xlink:href="https://evil.example/sprite.svg#x"/>',
    ]) {
      expect(contentMatchesType(svg(inner), 'image/svg+xml')).toBe(false);
    }
    expect(contentMatchesType(Buffer.from('<html>not an svg</html>'), 'image/svg+xml')).toBe(false);
  });
});
