-- Up Migration

-- The emails the directory sends: queued rather than sent while somebody waits, retried when
-- the mail server says no, and kept as the log of what was sent to whom.
--
-- `email_outbox` is the queue and the log at once. A row is written when a message is decided
-- on — inside a few milliseconds, whatever the mail server is doing — and a job sends it,
-- stamping what became of each attempt on the row. A save never waits on SMTP.
--
-- It sits beside `notification` rather than inside it: a notice is about one leave request and
-- says so with a NOT NULL foreign key, and these are about people. The retry rules are the same
-- shape as that table's, so the two read alike.
--
-- `email_opt_out` is who has turned off which optional email. A row is "turned off"; no row is
-- the default, which is on. The CHECK names the emails that may be turned off, so a mandatory
-- one cannot be silenced by any connection, whatever the screen or the service is persuaded to
-- send.

CREATE TABLE email_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    /* Which email this is, as the app that composed it names it. */
    kind TEXT NOT NULL,

    /* Who it is for, where that is somebody on the books. The address is kept as well, so the
       log says where it was sent rather than where that person's mail goes today. */
    recipient_employee_id BIGINT REFERENCES employee(id),
    to_address TEXT NOT NULL,

    /* "Ama Mensah via Remat Portal", where a person caused it, and their address for replies. */
    from_name TEXT,
    reply_to TEXT,

    /* The person who caused it, where one did: whoever changed a record, named a cover or wrote
       a message. What the hourly limit on messages counts, and who the log says sent it. */
    sender_employee_id BIGINT REFERENCES employee(id),

    subject TEXT NOT NULL,
    text_body TEXT NOT NULL,
    html_body TEXT NOT NULL,

    /* What makes a job safe to run twice: the second insert of the same key does nothing. */
    dedupe_key TEXT UNIQUE,

    status TEXT NOT NULL DEFAULT 'QUEUED',
    /* Sends made, delivered or not. */
    attempts INTEGER NOT NULL DEFAULT 0,
    /* When the next send is due. Null once it is sent or given up on. */
    next_attempt_at TIMESTAMPTZ DEFAULT now(),
    /* The last failure, in the transport's words. */
    last_error TEXT,
    /* Where it actually went, which is not `to_address` when MAIL_OVERRIDE_RECIPIENT is set. */
    delivered_to TEXT,
    sent_at TIMESTAMPTZ,
    gave_up_at TIMESTAMPTZ,

    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT email_outbox_kind_is_a_name CHECK (kind ~ '^[A-Z][A-Z_]*$'),

    CONSTRAINT email_outbox_to_an_address CHECK (to_address ~ '^[^@\s]+@[^@\s]+$'),

    CONSTRAINT email_outbox_says_something CHECK (
        btrim(subject) <> '' AND btrim(text_body) <> '' AND btrim(html_body) <> ''),

    CONSTRAINT email_outbox_status_known CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),

    CONSTRAINT email_outbox_attempts_not_negative CHECK (attempts >= 0),

    /* Queued is exactly "a send is due". */
    CONSTRAINT email_outbox_queued_is_due CHECK (
        (status = 'QUEUED') = (next_attempt_at IS NOT NULL)),

    /* Sent says when and where, and was attempted. */
    CONSTRAINT email_outbox_sent_says_when CHECK (
        status <> 'SENT'
        OR (sent_at IS NOT NULL AND delivered_to IS NOT NULL AND attempts > 0)),

    /* Given up says when and why. */
    CONSTRAINT email_outbox_failed_says_why CHECK (
        status <> 'FAILED'
        OR (gave_up_at IS NOT NULL AND last_error IS NOT NULL AND attempts > 0))
);

/* The queue the job drains. Partial, because a due row is a rare one. */
CREATE INDEX email_outbox_due ON email_outbox (next_attempt_at) WHERE status = 'QUEUED';

/* The log, newest first, and one person's part of it. */
CREATE INDEX email_outbox_newest_first ON email_outbox (queued_at DESC);
CREATE INDEX email_outbox_by_recipient ON email_outbox (recipient_employee_id);

/* What one person has sent lately, which is what the limit on messages asks. */
CREATE INDEX email_outbox_by_sender ON email_outbox (sender_employee_id, kind, queued_at);

-- ---------------------------------------------------------------- opting out

CREATE TABLE email_opt_out (
    employee_id BIGINT NOT NULL REFERENCES employee(id),
    email TEXT NOT NULL,
    opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (employee_id, email),

    /* The optional emails, and nothing else. `OPTIONAL_EMAILS` in apps/directory/email.ts is the
       same list, and the suite reads this constraint back against it. */
    CONSTRAINT email_opt_out_only_optional_emails CHECK (
        email IN ('NEW_COLLEAGUE', 'COVER_NAMED'))
);

-- ---------------------------------------------------------------- privileges

/* SELECT and INSERT come from the default privilege; restated for legibility. The outbox may
   have its delivery columns moved and nothing else: what was said is never rewritten, and no
   row is ever deleted, because the table is the log. */

GRANT SELECT, INSERT ON email_outbox TO lms_app;
GRANT UPDATE (status, attempts, next_attempt_at, last_error, delivered_to, sent_at, gave_up_at)
    ON email_outbox TO lms_app;

/* Turning an email back on is deleting the row that turned it off. */
GRANT SELECT, INSERT, DELETE ON email_opt_out TO lms_app;

-- Down Migration

DROP TABLE IF EXISTS email_opt_out;

DROP INDEX IF EXISTS email_outbox_by_sender;
DROP INDEX IF EXISTS email_outbox_by_recipient;
DROP INDEX IF EXISTS email_outbox_newest_first;
DROP INDEX IF EXISTS email_outbox_due;

DROP TABLE IF EXISTS email_outbox;
