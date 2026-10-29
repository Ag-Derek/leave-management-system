-- Up Migration

-- Who covers for somebody while they are on leave. #226.
--
-- Cover belongs to a leave request: who to contact instead, and for which of its days. One
-- request may be covered by different people over different parts of it, never by two at
-- once. The directory shows it only while the leave is agreed and under way, and the rows end
-- themselves when the leave does, whichever door ended it.

-- ------------------------------------------------------------- cover, for part of some leave

CREATE TABLE leave_cover (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    leave_request_id BIGINT NOT NULL REFERENCES leave_request(id),
    cover_employee_id BIGINT NOT NULL REFERENCES employee(id),

    /* Inclusive at both ends, as every period here. NFR DAT 03. */
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,

    /* Stamped rather than supplied, as every table here that records an act. */
    named_by TEXT NOT NULL,
    named_by_employee_id BIGINT REFERENCES employee(id),
    named_at TIMESTAMPTZ NOT NULL,

    /* Ended: the leave ended, or somebody named different cover. NULL while it stands. */
    ended_at TIMESTAMPTZ,
    ended_by TEXT,
    ended_by_employee_id BIGINT REFERENCES employee(id),
    ended_because TEXT,

    CONSTRAINT leave_cover_ends_after_it_starts CHECK (ends_on >= starts_on),

    CONSTRAINT leave_cover_ends_all_at_once CHECK (
        (ended_at IS NULL) = (ended_by IS NULL)
        AND (ended_at IS NULL) = (ended_because IS NULL)),

    CONSTRAINT leave_cover_ending_known CHECK (
        ended_because IS NULL OR ended_because IN ('LEAVE_ENDED', 'REPLACED')),

    CONSTRAINT leave_cover_named_by_not_blank CHECK (btrim(named_by) <> '')
);

/* One person to contact on any day. Two would leave a colleague choosing between them. An
   ended row drops out, so cover named wrongly is named again. */

ALTER TABLE leave_cover
    ADD CONSTRAINT leave_cover_one_person_a_day
    EXCLUDE USING gist (
        leave_request_id WITH =,
        daterange(starts_on, ends_on, '[]') WITH &&)
    WHERE (ended_at IS NULL);

CREATE INDEX leave_cover_by_request ON leave_cover (leave_request_id);

CREATE INDEX leave_cover_by_cover ON leave_cover (cover_employee_id, starts_on, ends_on);

-- ----------------------------------------------------- named on live leave, by somebody else

CREATE FUNCTION stamp_and_check_a_cover() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    leave leave_request%ROWTYPE;
BEGIN
    NEW.named_at := now();

    NEW.named_by := coalesce(
        nullif(btrim(current_setting('lms.audit.actor', true)), ''),
        'not named by the writer'
    );

    NEW.named_by_employee_id :=
        nullif(btrim(coalesce(current_setting('lms.audit.actor_employee_id', true), '')), '')::BIGINT;

    /* Cover is never born ended. */
    NEW.ended_at := NULL;
    NEW.ended_by := NULL;
    NEW.ended_by_employee_id := NULL;
    NEW.ended_because := NULL;

    SELECT * INTO leave FROM leave_request WHERE id = NEW.leave_request_id;

    /* The foreign key says so in its own words. */
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF leave.employee_id = NEW.cover_employee_id THEN
        RAISE EXCEPTION 'Employee % cannot cover their own leave, request %.',
            NEW.cover_employee_id, NEW.leave_request_id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_cover_is_somebody_else',
                  HINT = 'Cover is who colleagues contact instead. #226.';
    END IF;

    IF NEW.starts_on < leave.start_date OR NEW.ends_on > leave.end_date THEN
        RAISE EXCEPTION 'Cover from % to % is not inside leave request % (% to %).',
            NEW.starts_on, NEW.ends_on, NEW.leave_request_id, leave.start_date, leave.end_date
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_cover_inside_the_leave';
    END IF;

    IF leave.status NOT IN ('SUBMITTED', 'APPROVED', 'UNROUTABLE') THEN
        RAISE EXCEPTION 'Leave request % has ended (%), so nobody covers it.',
            NEW.leave_request_id, leave.status
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_cover_on_live_leave';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER leave_cover_records_who_named_it
    BEFORE INSERT ON leave_cover
    FOR EACH ROW
    EXECUTE FUNCTION stamp_and_check_a_cover();

/* The one UPDATE there is: ending it. Cover edited into different cover would rewrite what a
   colleague was told; different cover is a new row. */

CREATE FUNCTION end_a_cover_and_nothing_else() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cover % has already ended.', OLD.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_cover_ends_once';
    END IF;

    IF NEW.ended_because IS NULL
       OR NEW.leave_request_id IS DISTINCT FROM OLD.leave_request_id
       OR NEW.cover_employee_id IS DISTINCT FROM OLD.cover_employee_id
       OR NEW.starts_on IS DISTINCT FROM OLD.starts_on
       OR NEW.ends_on IS DISTINCT FROM OLD.ends_on
       OR NEW.named_by IS DISTINCT FROM OLD.named_by
       OR NEW.named_by_employee_id IS DISTINCT FROM OLD.named_by_employee_id
       OR NEW.named_at IS DISTINCT FROM OLD.named_at THEN
        RAISE EXCEPTION 'Cover % may only be ended, not edited.', OLD.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_cover_is_never_rewritten',
                  HINT = 'End it and name the new cover. #226.';
    END IF;

    /* Who ended it and when are the database's, as who named it is. */
    NEW.ended_at := now();

    NEW.ended_by := coalesce(
        nullif(btrim(current_setting('lms.audit.actor', true)), ''),
        'not named by the writer'
    );

    NEW.ended_by_employee_id :=
        nullif(btrim(coalesce(current_setting('lms.audit.actor_employee_id', true), '')), '')::BIGINT;

    RETURN NEW;
END
$$;

CREATE TRIGGER leave_cover_is_only_ever_ended
    BEFORE UPDATE ON leave_cover
    FOR EACH ROW
    EXECUTE FUNCTION end_a_cover_and_nothing_else();

CREATE TRIGGER leave_cover_is_never_deleted
    BEFORE DELETE ON leave_cover
    FOR EACH ROW
    EXECUTE FUNCTION refuse_delete();

CREATE TRIGGER leave_cover_is_audited
    AFTER INSERT OR UPDATE OR DELETE ON leave_cover
    FOR EACH ROW EXECUTE FUNCTION record_in_audit_log();

-- ------------------------------------------------------- and it ends when the leave does

/* Withdrawn, cancelled or refused, by whichever door: the cover ends in the same transaction,
   so nobody is pointed at a colleague for leave that is not happening. */

CREATE FUNCTION end_cover_with_the_leave() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE leave_cover
       SET ended_because = 'LEAVE_ENDED'
     WHERE leave_request_id = NEW.id
       AND ended_at IS NULL;

    RETURN NULL;
END
$$;

CREATE TRIGGER leave_request_ends_its_cover
    AFTER UPDATE OF status ON leave_request
    FOR EACH ROW
    WHEN (NEW.status IN ('WITHDRAWN', 'CANCELLED', 'REFUSED')
          AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION end_cover_with_the_leave();

/* A change of dates withdraws the request and writes its replacement. The cover ended by that
   withdrawal follows the leave to its new dates, cut to fit, and anything outside them is
   dropped. */

CREATE FUNCTION carry_cover_to_new_dates() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO leave_cover (leave_request_id, cover_employee_id, starts_on, ends_on)
    SELECT NEW.id,
           cover_employee_id,
           greatest(starts_on, NEW.start_date),
           least(ends_on, NEW.end_date)
      FROM leave_cover
     WHERE leave_request_id = NEW.replaces_request_id
       AND ended_because = 'LEAVE_ENDED'
       AND starts_on <= NEW.end_date
       AND ends_on >= NEW.start_date
     ORDER BY starts_on, id;

    RETURN NULL;
END
$$;

CREATE TRIGGER leave_request_keeps_its_cover
    AFTER INSERT ON leave_request
    FOR EACH ROW
    WHEN (NEW.replaces_request_id IS NOT NULL)
    EXECUTE FUNCTION carry_cover_to_new_dates();

-- ---------------------------------------------------------------- privileges

/* SELECT and INSERT arrive from the default privileges. UPDATE because ending it is an edit
   of the row; DELETE is not granted. */

GRANT UPDATE ON leave_cover TO lms_app;


-- Down Migration

DROP TRIGGER IF EXISTS leave_request_keeps_its_cover ON leave_request;
DROP FUNCTION IF EXISTS carry_cover_to_new_dates();

DROP TRIGGER IF EXISTS leave_request_ends_its_cover ON leave_request;
DROP FUNCTION IF EXISTS end_cover_with_the_leave();

DROP TRIGGER IF EXISTS leave_cover_is_audited ON leave_cover;
DROP TRIGGER IF EXISTS leave_cover_is_never_deleted ON leave_cover;
DROP TRIGGER IF EXISTS leave_cover_is_only_ever_ended ON leave_cover;
DROP TRIGGER IF EXISTS leave_cover_records_who_named_it ON leave_cover;

DROP FUNCTION IF EXISTS end_a_cover_and_nothing_else();
DROP FUNCTION IF EXISTS stamp_and_check_a_cover();

DROP TABLE IF EXISTS leave_cover;
