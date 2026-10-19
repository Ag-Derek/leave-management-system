/**
 * HR's light formatting in an email's message. FR 61.
 *
 * `**bold**`, `_italic_`, `__underline__`, and lines starting `- ` as a bulleted list. A
 * backslash makes the next character literal, which is how filled in values are kept from
 * formatting anything.
 */

/** A paragraph break: a blank line. */
const PARAGRAPH_BREAK = /\n[ \t]*(?:\n[ \t]*)+/;

const BULLET = /^\s*[-•]\s+/;

/** Escaped characters, swapped out while the markers are read. Private use code points. */
const HELD: Record<string, string> = { '\\': '\uE000', '*': '\uE001', _: '\uE002' };

/** A filled in value, with every marker character taken literally. */
export function literal(value: string): string {
  return value.replace(/[\\*_]/g, '\\$&');
}

/** The message as plain text: the markers dropped, the escapes undone. */
export function asPlainText(body: string): string {
  return paragraphsOf(body)
    .map((lines) => lines.map((line) => inline(line, false)).join('\n'))
    .join('\n\n');
}

/** The message as an HTML email, a `<p>` or `<ul>` per run of lines. */
export function asHtml(body: string): string {
  const blocks = paragraphsOf(body).flatMap((lines) => blocksOf(lines));

  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111111">' +
    blocks.join('') +
    '</div>'
  );
}

function paragraphsOf(body: string): string[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(PARAGRAPH_BREAK)
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => paragraph.split('\n'));
}

/** Consecutive bullet lines become one list; the lines between them one paragraph. */
function blocksOf(lines: string[]): string[] {
  const blocks: string[] = [];
  let run: string[] = [];
  let bullets = false;

  const flush = () => {
    if (run.length === 0) {
      return;
    }

    blocks.push(
      bullets
        ? `<ul style="margin:0 0 1em;padding-left:1.4em">${run.map((item) => `<li>${item}</li>`).join('')}</ul>`
        : `<p style="margin:0 0 1em">${run.join('<br>')}</p>`,
    );
    run = [];
  };

  for (const line of lines) {
    const isBullet = BULLET.test(line);

    if (isBullet !== bullets) {
      flush();
      bullets = isBullet;
    }

    run.push(inline(isBullet ? line.replace(BULLET, '') : line, true));
  }

  flush();

  return blocks;
}

/** One line with its markers read, as HTML or as plain text. */
function inline(line: string, html: boolean): string {
  let text = line.replace(/\\([\\*_])/g, (_whole, held: string) => HELD[held] ?? held);

  if (html) {
    text = escapeHtml(text);
  }

  const tag = (name: string) => (_whole: string, inner: string) =>
    html ? `<${name}>${inner}</${name}>` : inner;

  text = text
    .replace(/\*\*(?=\S)(.*?\S)\*\*/g, tag('strong'))
    .replace(/__(?=\S)(.*?\S)__/g, tag('u'))
    .replace(
      /(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu,
      (_whole, before: string, inner: string) => before + (html ? `<em>${inner}</em>` : inner),
    );

  return text
    .replace(/\uE000/g, '\\')
    .replace(/\uE001/g, '*')
    .replace(/\uE002/g, '_');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
