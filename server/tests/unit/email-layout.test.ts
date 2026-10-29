import { describe, expect, it } from 'vitest';
import { type EmailContent, oneLine, renderEmail } from '../../src/core/notification/layout.js';

/**
 * The company layout every email is poured into.
 *
 * Three claims: one description renders both parts and the text part says everything the HTML
 * does; nothing a person typed can become markup; and the HTML is the shape a phone draws
 * properly.
 */

const CONTENT: EmailContent = {
  preview: 'Today is your first day.',
  greeting: 'Hello Esi,',
  paragraphs: ['Welcome to Remat.', 'Your profile is in the directory.'],
  facts: [
    { label: 'Job title', value: 'Operations Officer' },
    { label: 'Manager', value: 'Kofi Boateng' },
  ],
  action: { label: 'Complete your profile', href: 'https://portal.example/#/directory/7' },
  afterAction: ['You sign in with this email address.'],
  signOff: 'Remat Portal',
  footer: ['This email is about your employment, so it is always sent.'],
};

describe('the plain text part', () => {
  it('is always there, and carries every paragraph, fact and the button’s address', () => {
    const { text } = renderEmail(CONTENT);

    expect(text).toContain('Hello Esi,');
    expect(text).toContain('Welcome to Remat.');
    expect(text).toContain('Job title: Operations Officer');
    expect(text).toContain('Complete your profile:\nhttps://portal.example/#/directory/7');
    expect(text).toContain('You sign in with this email address.');
    expect(text).toContain('This email is about your employment');
  });

  it('puts what to do about the facts before the button, and the rest after it', () => {
    const { text, html } = renderEmail({
      ...CONTENT,
      afterFacts: ['Check these are right.'],
    });

    for (const part of [text, html]) {
      expect(part.indexOf('Check these are right.')).toBeGreaterThan(part.indexOf('Kofi Boateng'));
      expect(part.indexOf('Check these are right.')).toBeLessThan(
        part.indexOf('Complete your profile'),
      );
      expect(part.indexOf('You sign in')).toBeGreaterThan(part.indexOf('Complete your profile'));
    }
  });

  it('has no markup in it', () => {
    expect(renderEmail(CONTENT).text).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it('leaves the preview line out, which is for the inbox and not the message', () => {
    expect(renderEmail(CONTENT).text).not.toContain('Today is your first day.');
  });
});

describe('the HTML part', () => {
  it('escapes everything it is given, so a name cannot become markup', () => {
    const { html } = renderEmail({
      ...CONTENT,
      greeting: 'Hello <script>alert(1)</script>,',
      facts: [{ label: 'Job title', value: '"><img src=x onerror=alert(1)>' }],
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('will not put anything but a web address behind the button', () => {
    const { html, text } = renderEmail({
      ...CONTENT,
      action: { label: 'Open', href: 'javascript:alert(1)' },
    });

    expect(html).not.toContain('javascript:');
    expect(text).not.toContain('javascript:');
  });

  it('carries the preview line, hidden', () => {
    expect(renderEmail(CONTENT).html).toMatch(/display:none[^>]*>Today is your first day\./);
  });

  it('is in the portal’s colours, under its name', () => {
    const { html } = renderEmail(CONTENT);

    expect(html).toContain('#020202');
    expect(html).toContain('#006afe');
    expect(html).toContain('Remat</span>');
    expect(html).toContain(' Portal</span>');
  });
});

describe('somebody’s own words', () => {
  const quoted = renderEmail({
    ...CONTENT,
    quote: { title: 'Lunch on Friday', paragraphs: ['Are you free?\nAround one.', '<i>Ama</i>'] },
    action: {
      label: 'View her profile',
      href: 'https://portal.example/#/directory/2',
      quiet: true,
    },
  });

  it('are set apart in a card with a bar down its side, title first', () => {
    expect(quoted.html).toMatch(
      /class="quote"[\s\S]*border-left:4px solid #006afe[\s\S]*Lunch on Friday[\s\S]*Are you free\?<br>Around one\./,
    );
    expect(quoted.html).toContain('&lt;i&gt;Ama&lt;/i&gt;');
  });

  it('are quoted line by line in the plain text', () => {
    expect(quoted.text).toContain(
      '> Lunch on Friday\n>\n> Are you free?\n> Around one.\n>\n> <i>Ama</i>',
    );
  });

  it('can come with a quiet button, small and its own width on a phone', () => {
    expect(quoted.html).not.toContain('class="button"');
    expect(quoted.html).toContain('padding:7px 14px');
    expect(renderEmail(CONTENT).html).toContain('class="button"');
  });
});

describe('on a phone', () => {
  const { html } = renderEmail(CONTENT);

  it('asks to be laid out at the width of the screen', () => {
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  it('is one column of at most 600 pixels, and the full width of anything narrower', () => {
    expect(html).toContain('max-width:600px');
    expect(html).toContain('width="100%"');
    /* Nothing is given a fixed width wider than a phone. */
    for (const [, width] of html.matchAll(/width="(\d+)"/g)) {
      expect(Number(width)).toBeLessThanOrEqual(320);
    }
  });

  it('makes the button the width of the screen, and tightens the margins', () => {
    expect(html).toMatch(/@media only screen and \(max-width: 620px\)/);
    expect(html).toMatch(/\.button, \.button td, \.button a \{ width: 100% !important/);
  });

  it('keeps text at a size a phone does not have to zoom', () => {
    const sizes = [...html.matchAll(/font-size:(\d+)px/g)].map((match) => Number(match[1]));

    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    expect(html).toContain('font-size:16px');
  });
});

describe('a subject line', () => {
  it('is one line, so it cannot add a header', () => {
    expect(oneLine('Welcome\r\nBcc: everybody@example.com')).toBe(
      'Welcome Bcc: everybody@example.com',
    );
  });
});
