import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMailStaysHere, createMailer } from '../../src/core/notification/mailer.js';
import { fromAddress } from '../../src/core/notification/transport.js';

/**
 * No real email leaves development.
 *
 * Outside production the process refuses to start unless every message is going to Mailpit on
 * this machine or to the one safe inbox in MAIL_OVERRIDE_RECIPIENT. The override itself is
 * proved end to end in ../integration/mail.test.ts.
 */

describe('outside production', () => {
  it('sends to Mailpit on this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', 'mailpit', 'LOCALHOST']) {
      expect(() => {
        checkMailStaysHere({ NODE_ENV: 'development', SMTP_HOST: host });
      }).not.toThrow();
    }
  });

  it('refuses a real SMTP server, which would reach real people', () => {
    expect(() => {
      checkMailStaysHere({ NODE_ENV: 'development', SMTP_HOST: 'smtp.office365.com' });
    }).toThrow(/SMTP_HOST is smtp\.office365\.com outside production/);
  });

  it('refuses Resend, which would reach real people', () => {
    expect(() => {
      checkMailStaysHere({ NODE_ENV: 'development', RESEND_API_KEY: 're_live_key' });
    }).toThrow(/RESEND_API_KEY is set outside production/);
  });

  it('allows either once every message is redirected to a safe inbox', () => {
    expect(() => {
      checkMailStaysHere({
        NODE_ENV: 'development',
        RESEND_API_KEY: 're_live_key',
        MAIL_OVERRIDE_RECIPIENT: 'safe-inbox@rematholdings.com',
      });
    }).not.toThrow();
    expect(() => {
      checkMailStaysHere({
        NODE_ENV: 'staging',
        SMTP_HOST: 'smtp.office365.com',
        MAIL_OVERRIDE_RECIPIENT: 'safe-inbox@rematholdings.com',
      });
    }).not.toThrow();
  });

  it('treats NODE_ENV unset as development, not as production', () => {
    expect(() => {
      checkMailStaysHere({ RESEND_API_KEY: 're_live_key' });
    }).toThrow();
  });

  it('is checked when the mailer is built, so the process stops before it sends anything', () => {
    expect(() =>
      createMailer({ NODE_ENV: 'development', RESEND_API_KEY: 're_live_key' }),
    ).toThrow();
  });
});

describe('in production', () => {
  it('sends to the configured service', () => {
    expect(() => {
      checkMailStaysHere({ NODE_ENV: 'production', RESEND_API_KEY: 're_live_key' });
    }).not.toThrow();
    expect(() => {
      checkMailStaysHere({ NODE_ENV: 'production', SMTP_HOST: 'smtp.office365.com' });
    }).not.toThrow();
  });
});

describe('the sender', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.MAIL_FROM_NAME = 'Rota';
    process.env.MAIL_FROM_ADDRESS = 'leave@rematholdings.com';
  });

  afterEach(() => {
    process.env.MAIL_FROM_NAME = saved.MAIL_FROM_NAME;
    process.env.MAIL_FROM_ADDRESS = saved.MAIL_FROM_ADDRESS;
  });

  it('is the system’s name and address by default', () => {
    expect(fromAddress()).toBe('"Rota" <leave@rematholdings.com>');
  });

  it('can carry a person’s name, and is still the system’s address', () => {
    expect(fromAddress('Ama Mensah via Remat Portal')).toBe(
      '"Ama Mensah via Remat Portal" <leave@rematholdings.com>',
    );
  });

  it('cannot be made into a second address or a second header by the name', () => {
    expect(fromAddress('Ama "x" <evil@example.com>\r\nBcc: all@example.com')).toBe(
      '"Ama x evil@example.com Bcc: all@example.com" <leave@rematholdings.com>',
    );
  });
});
