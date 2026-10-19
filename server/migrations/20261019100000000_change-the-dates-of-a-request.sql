-- Up Migration

-- Changing the dates of a request nobody has decided.
--
-- A change is a new request that replaces the old one, so a request's price is still never
-- rewritten. In one transaction the old request is withdrawn, its days come back, the new one
-- is written naming it, its files move across, and the new days are held.

ALTER TABLE leave_request
    ADD COLUMN replaces_request_id BIGINT UNIQUE REFERENCES leave_request(id);

-- ------------------------------------------------------------- written once, on insert

CREATE FUNCTION refuse_rewriting_what_a_request_replaces() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.replaces_request_id IS DISTINCT FROM OLD.replaces_request_id THEN
        RAISE EXCEPTION 'Leave request % replaces the request it was written to replace.', OLD.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_replaces_what_it_replaced';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER leave_request_replaces_what_it_replaced
    BEFORE UPDATE ON leave_request
    FOR EACH ROW
    EXECUTE FUNCTION refuse_rewriting_what_a_request_replaces();

-- -------------------- and what it replaces is the same person's leave, ended by the change

CREATE FUNCTION refuse_replacing_a_request_that_did_not_end() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    replaced leave_request%ROWTYPE;
BEGIN
    IF NEW.replaces_request_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT * INTO replaced FROM leave_request WHERE id = NEW.replaces_request_id;

    IF replaced.employee_id <> NEW.employee_id
    OR replaced.leave_type_id <> NEW.leave_type_id
    OR replaced.status <> 'WITHDRAWN'
    THEN
        RAISE EXCEPTION
            'Leave request % replaces request %, which is not the same person''s leave of the '
            'same type withdrawn by the change.', NEW.id, NEW.replaces_request_id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_replaces_one_it_ended';
    END IF;

    RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER leave_request_replaces_one_it_ended
    AFTER INSERT ON leave_request
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION refuse_replacing_a_request_that_did_not_end();

-- ------------------------------------- the files follow the leave to its replacement

/* The retention body, plus: a file may move from a request to the one replacing it,
   keeping its slot. */
CREATE OR REPLACE FUNCTION refuse_rewriting_an_attachment() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    being_put_on_a_request BOOLEAN :=
        OLD.leave_request_id IS NULL AND NEW.leave_request_id IS NOT NULL;
    following_its_replacement BOOLEAN :=
        OLD.leave_request_id IS NOT NULL
        AND NEW.slot IS NOT DISTINCT FROM OLD.slot
        AND EXISTS (
            SELECT 1 FROM leave_request
            WHERE id = NEW.leave_request_id AND replaces_request_id = OLD.leave_request_id);
BEGIN
    IF NEW.filename            IS DISTINCT FROM OLD.filename
    OR NEW.content_type        IS DISTINCT FROM OLD.content_type
    OR NEW.size_bytes          IS DISTINCT FROM OLD.size_bytes
    OR NEW.checksum_sha256     IS DISTINCT FROM OLD.checksum_sha256
    OR NEW.storage_key         IS DISTINCT FROM OLD.storage_key
    OR NEW.held_for_employee_id IS DISTINCT FROM OLD.held_for_employee_id
    OR NEW.uploaded_by         IS DISTINCT FROM OLD.uploaded_by
    OR NEW.uploaded_at         IS DISTINCT FROM OLD.uploaded_at
    OR (NOT being_put_on_a_request
        AND NOT following_its_replacement
        AND (NEW.leave_request_id IS DISTINCT FROM OLD.leave_request_id
             OR NEW.slot          IS DISTINCT FROM OLD.slot))
    THEN
        RAISE EXCEPTION
            'Attachment % is the file that was uploaded and cannot be made into another.',
            OLD.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_attachment_is_the_file_it_was',
                  HINT = 'Remove it and attach the right file. FR 12.';
    END IF;

    IF OLD.scan_status <> 'PENDING' AND NEW.scan_status IS DISTINCT FROM OLD.scan_status THEN
        RAISE EXCEPTION
            'Attachment % was already scanned and called %.', OLD.id, OLD.scan_status
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_attachment_is_scanned_once',
                  HINT = 'A verdict is given once. NFR SEC 07.';
    END IF;

    IF OLD.file_deleted_at IS NOT NULL
       AND NEW.file_deleted_at IS DISTINCT FROM OLD.file_deleted_at THEN
        RAISE EXCEPTION 'The file on attachment % was already deleted.', OLD.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_attachment_file_is_deleted_once',
                  HINT = 'A deleted file cannot come back. NFR SEC 06.';
    END IF;

    RETURN NEW;
END
$$;

/* A request whose files went to its replacement has none, and is owed none. */
CREATE OR REPLACE FUNCTION refuse_a_request_that_needed_evidence_and_has_none() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.evidence_required
    AND NOT EXISTS (
        SELECT 1 FROM leave_request_attachment
        WHERE leave_request_id = NEW.id AND scan_status = 'CLEAN')
    AND NOT EXISTS (
        SELECT 1 FROM leave_request WHERE replaces_request_id = NEW.id)
    THEN
        RAISE EXCEPTION
            'Leave request % needs supporting documentation and has none that has been '
            'scanned and found clean.', NEW.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_that_needed_evidence_has_it',
                  HINT = 'Attach the certificate and ask again. FR 13, FR 32a.';
    END IF;

    RETURN NULL;
END
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION refuse_a_request_that_needed_evidence_and_has_none() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.evidence_required
    AND NOT EXISTS (
        SELECT 1 FROM leave_request_attachment
        WHERE leave_request_id = NEW.id AND scan_status = 'CLEAN')
    THEN
        RAISE EXCEPTION
            'Leave request % needs supporting documentation and has none that has been '
            'scanned and found clean.', NEW.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_that_needed_evidence_has_it',
                  HINT = 'Attach the certificate and ask again. FR 13, FR 32a.';
    END IF;

    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION refuse_rewriting_an_attachment() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    being_put_on_a_request BOOLEAN :=
        OLD.leave_request_id IS NULL AND NEW.leave_request_id IS NOT NULL;
BEGIN
    IF NEW.filename            IS DISTINCT FROM OLD.filename
    OR NEW.content_type        IS DISTINCT FROM OLD.content_type
    OR NEW.size_bytes          IS DISTINCT FROM OLD.size_bytes
    OR NEW.checksum_sha256     IS DISTINCT FROM OLD.checksum_sha256
    OR NEW.storage_key         IS DISTINCT FROM OLD.storage_key
    OR NEW.held_for_employee_id IS DISTINCT FROM OLD.held_for_employee_id
    OR NEW.uploaded_by         IS DISTINCT FROM OLD.uploaded_by
    OR NEW.uploaded_at         IS DISTINCT FROM OLD.uploaded_at
    OR (NOT being_put_on_a_request
        AND (NEW.leave_request_id IS DISTINCT FROM OLD.leave_request_id
             OR NEW.slot          IS DISTINCT FROM OLD.slot))
    THEN
        RAISE EXCEPTION
            'Attachment % is the file that was uploaded and cannot be made into another.',
            OLD.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_attachment_is_the_file_it_was',
                  HINT = 'Remove it and attach the right file. FR 12.';
    END IF;

    IF OLD.scan_status <> 'PENDING' AND NEW.scan_status IS DISTINCT FROM OLD.scan_status THEN
        RAISE EXCEPTION
            'Attachment % was already scanned and called %.', OLD.id, OLD.scan_status
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_attachment_is_scanned_once',
                  HINT = 'A verdict is given once. NFR SEC 07.';
    END IF;

    IF OLD.file_deleted_at IS NOT NULL
       AND NEW.file_deleted_at IS DISTINCT FROM OLD.file_deleted_at THEN
        RAISE EXCEPTION 'The file on attachment % was already deleted.', OLD.id
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'leave_request_attachment_file_is_deleted_once',
                  HINT = 'A deleted file cannot come back. NFR SEC 06.';
    END IF;

    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS leave_request_replaces_one_it_ended ON leave_request;
DROP TRIGGER IF EXISTS leave_request_replaces_what_it_replaced ON leave_request;
DROP FUNCTION IF EXISTS refuse_replacing_a_request_that_did_not_end();
DROP FUNCTION IF EXISTS refuse_rewriting_what_a_request_replaces();

ALTER TABLE leave_request
    DROP COLUMN replaces_request_id;
