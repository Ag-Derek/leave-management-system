/**
 * The company's email, as one layout every message is poured into.
 *
 * One description of a message renders both parts, so there is no email with an HTML part and
 * no plain text, and no plain text that says something the HTML does not. The HTML is a single
 * column of tables with the styles inline, which is what Outlook, Gmail and a phone's mail app
 * all draw the same way: 600 pixels at most, the full width of anything narrower, and a button
 * that becomes the width of the screen on a phone.
 *
 * Colours are the portal's (client/src/styles.css): the black rail, the blue accent, the pale
 * page. Text is Inter where the reader has it and Arial where they do not.
 */

/** What one message says, before it is laid out. */
export interface EmailContent {
  /** The line an inbox shows beside the subject. Never shown in the message itself. */
  preview: string;
  /** "Hello Ama," */
  greeting: string;
  paragraphs: readonly string[];
  /**
   * Somebody's own words, set apart from the email's: a message a colleague wrote. Drawn as a
   * card with a bar down its side, and quoted with `>` in the plain text.
   */
  quote?: { title?: string; paragraphs: readonly string[] };
  /** Short labelled facts, as "Job title: Analyst". Drawn as a small table. */
  facts?: readonly EmailFact[];
  /** Paragraphs after the facts and before the button: what to do about them. */
  afterFacts?: readonly string[];
  /**
   * The one thing to do, as a button. An absolute address. `quiet` draws it small and outlined,
   * for a link that is there if wanted rather than the point of the email.
   */
  action?: { label: string; href: string; quiet?: boolean };
  /** Paragraphs after the button. */
  afterAction?: readonly string[];
  /** Who it is from, under the message. */
  signOff: string;
  /** Small print: why they got it, and whether they can stop it. */
  footer: readonly string[];
}

export interface EmailFact {
  label: string;
  value: string;
}

/** Both parts of one message. */
export interface RenderedEmail {
  text: string;
  html: string;
}

/** The name across the top of every message. */
export const BRAND_NAME = 'Remat Portal';

const COLOUR = {
  page: '#f4f6fa',
  card: '#ffffff',
  rail: '#020202',
  railInk: '#ffffff',
  accent: '#006afe',
  accentInk: '#ffffff',
  ink: '#020202',
  inkSoft: '#5f6368',
  line: '#e6e8ec',
  factBackground: '#f7f9fc',
} as const;

const FONT = "Inter, 'Segoe UI', Arial, Helvetica, sans-serif";

/** Both parts, from one description. */
export function renderEmail(content: EmailContent): RenderedEmail {
  return { text: asText(content), html: asHtml(content) };
}

/**
 * The plain text part. What a watch, a screen reader and a mail client with HTML turned off
 * read, so everything the HTML says is here, the button's address included.
 */
function asText(content: EmailContent): string {
  const blocks: string[] = [content.greeting, ...content.paragraphs];

  if (content.quote !== undefined) {
    const quoted = [
      ...(content.quote.title === undefined ? [] : [content.quote.title]),
      ...content.quote.paragraphs,
    ];

    blocks.push(
      quoted
        .map((block) =>
          block
            .split(/\r?\n/)
            .map((line) => `> ${line}`)
            .join('\n'),
        )
        .join('\n>\n'),
    );
  }

  if (content.facts !== undefined && content.facts.length > 0) {
    blocks.push(content.facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n'));
  }

  blocks.push(...(content.afterFacts ?? []));

  if (content.action !== undefined) {
    blocks.push(`${content.action.label}:\n${safeHref(content.action.href)}`);
  }

  blocks.push(...(content.afterAction ?? []), content.signOff);

  if (content.footer.length > 0) {
    blocks.push(['--', ...content.footer].join('\n'));
  }

  return (
    blocks
      .map((block) => block.trim())
      .filter((block) => block !== '')
      .join('\n\n') + '\n'
  );
}

function asHtml(content: EmailContent): string {
  /* A line break inside a paragraph stays one, after escaping, so it can carry nothing else. */
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${COLOUR.ink}">${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>`;

  const facts =
    content.facts === undefined || content.facts.length === 0
      ? ''
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;background:${COLOUR.factBackground};border:1px solid ${COLOUR.line};border-radius:8px">` +
        content.facts
          .map(
            (fact) =>
              '<tr>' +
              `<td class="fact-label" style="padding:10px 14px;font-size:13px;line-height:1.4;color:${COLOUR.inkSoft};vertical-align:top;width:38%">${escapeHtml(fact.label)}</td>` +
              `<td style="padding:10px 14px;font-size:15px;line-height:1.4;color:${COLOUR.ink};vertical-align:top;font-weight:600">${escapeHtml(fact.value)}</td>` +
              '</tr>',
          )
          .join('') +
        '</table>';

  /* A card with a bar down its side, its title above what was written. */
  const quote =
    content.quote === undefined
      ? ''
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="quote" style="margin:4px 0 24px">` +
        `<tr><td style="border-left:4px solid ${COLOUR.accent};background:${COLOUR.factBackground};border-radius:0 8px 8px 0;padding:18px 22px">` +
        (content.quote.title === undefined
          ? ''
          : `<p style="margin:0 0 12px;font-size:17px;line-height:1.4;font-weight:700;color:${COLOUR.ink}">${escapeHtml(content.quote.title)}</p>`) +
        content.quote.paragraphs
          .map(
            (text, at, all) =>
              `<p style="margin:0 0 ${at === all.length - 1 ? '0' : '12px'};font-size:16px;line-height:1.6;color:${COLOUR.ink}">${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>`,
          )
          .join('') +
        '</td></tr></table>';

  const href = content.action === undefined ? '' : escapeHtml(safeHref(content.action.href));

  /* The main button is solid and goes the width of a phone. A quiet one is small, outlined, and
     stays its own size: it is there if wanted, not the point of the email. */
  const action =
    content.action === undefined
      ? ''
      : content.action.quiet === true
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px">` +
          `<tr><td style="border:1px solid ${COLOUR.line};border-radius:6px">` +
          `<a href="${href}" style="display:inline-block;padding:7px 14px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1.2;color:${COLOUR.accent};text-decoration:none;border-radius:6px">${escapeHtml(content.action.label)}</a>` +
          '</td></tr></table>'
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="button" style="margin:8px 0 24px">` +
          `<tr><td style="border-radius:8px;background:${COLOUR.accent}">` +
          `<a href="${href}" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1.2;color:${COLOUR.accentInk};text-decoration:none;border-radius:8px">${escapeHtml(content.action.label)}</a>` +
          '</td></tr></table>';

  const footer = content.footer
    .map(
      (line) =>
        `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${COLOUR.inkSoft}">${escapeHtml(line)}</p>`,
    )
    .join('');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(BRAND_NAME)}</title>`,
    '<style>',
    /* Only what a phone needs. Every client that ignores a style block still gets the inline
       styles, which are already readable at any width. */
    '@media only screen and (max-width: 620px) {',
    '  .shell { padding: 0 !important; }',
    '  .card { border-radius: 0 !important; }',
    '  .content { padding: 24px 20px !important; }',
    '  .button, .button td, .button a { width: 100% !important; text-align: center !important; }',
    '  .fact-label { width: 42% !important; }',
    '  .quote td { padding: 16px 16px !important; }',
    '}',
    '</style>',
    '</head>',
    `<body style="margin:0;padding:0;background:${COLOUR.page};-webkit-text-size-adjust:100%">`,
    /* The preview line, hidden from the message and read by the inbox. */
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preview)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOUR.page}">`,
    '<tr><td class="shell" align="center" style="padding:24px 12px">',
    `<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${COLOUR.card};border-radius:14px;overflow:hidden;font-family:${FONT}">`,
    `<tr><td style="background:${COLOUR.rail};padding:18px 28px">` +
      `<span style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${COLOUR.railInk}">Remat</span>` +
      `<span style="font-family:${FONT};font-size:18px;font-weight:400;color:${COLOUR.accent}"> Portal</span>` +
      '</td></tr>',
    `<tr><td class="content" style="padding:32px 28px;font-family:${FONT}">`,
    paragraph(content.greeting),
    ...content.paragraphs.map(paragraph),
    quote,
    facts,
    ...(content.afterFacts ?? []).map(paragraph),
    action,
    ...(content.afterAction ?? []).map(paragraph),
    `<p style="margin:8px 0 0;font-size:16px;line-height:1.6;color:${COLOUR.ink}">${escapeHtml(content.signOff)}</p>`,
    '</td></tr>',
    footer === ''
      ? ''
      : `<tr><td style="padding:18px 28px 24px;border-top:1px solid ${COLOUR.line};font-family:${FONT}">${footer}</td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * An address safe to put behind a button: http or https, and nothing else.
 *
 * Every address here is built from `APP_URL`, so this is a guard against a misconfiguration
 * rather than against a person — but a `javascript:` link in a company email is the kind of
 * thing that should be impossible rather than unlikely.
 */
function safeHref(href: string): string {
  return /^https?:\/\//i.test(href) ? href : '#';
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A subject line made safe for a header: one line, no runs of spaces. */
export function oneLine(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
