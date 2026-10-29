import { useEffect, useState } from 'react';
import { isNotSignedIn, sendMessage } from '../../api';
import { Icon } from '../../Icon';
import { Modal } from '../../Modal';
import { Notice, type Problem, problemFrom } from '../../problem';

/** The longest a subject and a message may be. The server holds the same limits. */
const LONGEST_SUBJECT = 150;
const LONGEST_MESSAGE = 5000;

/** How long "Sent" stays beside the icon. */
const SAID_FOR_MS = 4000;

/**
 * Writing to a colleague from their profile, without leaving the portal.
 *
 * The message goes from the portal's address under the writer's name, and a reply comes back to
 * the writer's own inbox. The writer is sent a copy, since nothing lands in their Sent folder.
 */
export function SendMessage({
  to,
  onSignedOut,
}: {
  to: { employeeId: string; firstName: string; lastName: string };
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!sent) {
      return;
    }

    const timer = setTimeout(() => {
      setSent(false);
    }, SAID_FOR_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [sent]);

  return (
    <>
      <button
        type="button"
        className="iconic action-icon is-edit"
        title="Send a message"
        onClick={() => {
          setSent(false);
          setOpen(true);
        }}
      >
        <Icon name="mail" />
        <span className="visually-hidden">
          Send {to.firstName} {to.lastName} a message
        </span>
      </button>
      <span className="icon-said" role="status">
        {sent ? 'Sent. A copy is in your inbox.' : ''}
      </span>

      {open ? (
        <MessageForm
          to={to}
          onSent={() => {
            setOpen(false);
            setSent(true);
          }}
          onClose={() => {
            setOpen(false);
          }}
          onSignedOut={onSignedOut}
        />
      ) : null}
    </>
  );
}

function MessageForm({
  to,
  onSent,
  onClose,
  onSignedOut,
}: {
  to: { employeeId: string; firstName: string; lastName: string };
  onSent: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Problem | undefined>(undefined);

  const ready = subject.trim() !== '' && message.trim() !== '' && !busy;

  const send = () => {
    if (!ready) {
      return;
    }

    setBusy(true);
    setRefusal(undefined);

    sendMessage(to.employeeId, { subject, message })
      .then(onSent)
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setRefusal(problemFrom(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Modal
      title={`Message ${to.firstName} ${to.lastName}`}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      actions={
        <span className="modal-actions-end">
          <button type="button" className="linkish" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!ready} onClick={send}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </span>
      }
    >
      {refusal === undefined ? null : <Notice problem={refusal} />}

      <label>
        Subject
        <input
          type="text"
          value={subject}
          maxLength={LONGEST_SUBJECT}
          disabled={busy}
          aria-invalid={refusal?.field === 'subject' ? true : undefined}
          onChange={(event) => {
            setSubject(event.target.value);
          }}
        />
      </label>

      <label>
        Message
        <textarea
          rows={8}
          value={message}
          maxLength={LONGEST_MESSAGE}
          disabled={busy}
          aria-invalid={refusal?.field === 'message' ? true : undefined}
          onChange={(event) => {
            setMessage(event.target.value);
          }}
        />
      </label>

      <p className="muted">
        Sent from the Remat Portal under your name. {to.firstName}’s reply comes to your own inbox,
        and you get a copy of what you send.
      </p>
    </Modal>
  );
}
