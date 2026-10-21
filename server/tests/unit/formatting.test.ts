import { describe, expect, it } from 'vitest';
import { asHtml, asPlainText, literal } from '../../src/core/notification/formatting.js';
import { fillIn } from '../../src/apps/leave/notification/wording.js';

/** HR's light formatting in an email's message. FR 61. */

describe('the HTML part', () => {
  it('reads bold, italic and underline', () => {
    expect(asHtml('A **firm** _soft_ __lined__ word')).toContain(
      'A <strong>firm</strong> <em>soft</em> <u>lined</u> word',
    );
  });

  it('makes each paragraph a <p>, and a line break inside one a <br>', () => {
    const html = asHtml('One\ntwo\n\nThree');

    expect(html).toContain('>One<br>two</p>');
    expect(html).toContain('>Three</p>');
  });

  it('makes a run of "- " lines a list, keeping the lines around it', () => {
    const html = asHtml('Before\n- first\n- second\nAfter');

    expect(html).toContain('>Before</p>');
    expect(html).toContain('<li>first</li><li>second</li></ul>');
    expect(html).toContain('>After</p>');
  });

  it('escapes HTML, so nothing typed becomes markup', () => {
    expect(asHtml('<b>"x" & y</b>')).toContain('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  });

  it('leaves an underscore inside a word alone', () => {
    expect(asHtml('the snake_case_name')).toContain('the snake_case_name');
  });

  it('leaves a marker that is never closed alone', () => {
    expect(asHtml('5 ** 2 and a lone _')).toContain('5 ** 2 and a lone _');
  });
});

describe('the plain text part', () => {
  it('drops the markers and keeps the words', () => {
    expect(asPlainText('A **firm** _soft_ __lined__ word')).toBe('A firm soft lined word');
  });

  it('keeps bullets and paragraphs as they were typed', () => {
    expect(asPlainText('Before\n- first\n\nAfter')).toBe('Before\n- first\n\nAfter');
  });
});

describe('filled in values', () => {
  it('are taken literally, so a comment formats nothing', () => {
    const { body } = fillIn(
      { subject: 'S', body: '**Said:** {{comment}}' },
      { comment: 'use the **old** form_a_b' },
    );

    expect(asPlainText(body)).toBe('Said: use the **old** form_a_b');
    expect(asHtml(body)).toContain('<strong>Said:</strong> use the **old** form_a_b');
  });

  it('keep a backslash as a backslash', () => {
    expect(asPlainText(literal('C:\\leave'))).toBe('C:\\leave');
  });

  it('are not escaped in the subject, which is never formatted', () => {
    const { subject } = fillIn({ subject: 'About {{comment}}', body: 'B' }, { comment: 'a_b' });

    expect(subject).toBe('About a_b');
  });
});
