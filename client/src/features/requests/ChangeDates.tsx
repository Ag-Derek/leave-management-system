import { useEffect, useRef, useState } from 'react';
import {
  changeRequestDates,
  isNotSignedIn,
  type Quote,
  quoteChange,
  type RequestEntry,
} from '../../api';
import { days, inDays, period } from '../../format';
import { Modal } from '../../Modal';
import { Notice, type Problem, problemFrom } from '../../problem';
import { AttachedFiles } from './Attachments';

/**
 * Editing a request nobody has decided yet: its dates, and its files.
 *
 * Files are saved as they are added. New dates are saved with the button: the server withdraws
 * the old request and writes the new one in its place, files and all, so it goes back to its
 * first approver. Priced as the dates move, with the old days counted as back.
 */
export function ChangeDates({
  entry,
  onChanged,
  onClose,
  onSignedOut,
}: {
  entry: RequestEntry;
  onChanged: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [from, setFrom] = useState(entry.from);
  const [to, setTo] = useState(entry.to);
  const [quote, setQuote] = useState<Quote | undefined>(undefined);
  const [quoteProblem, setQuoteProblem] = useState<Problem | undefined>(undefined);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Problem | undefined>(undefined);
  /** The latest question, so an older answer landing late is dropped. */
  const asked = useRef(0);

  const unchanged = from === entry.from && to === entry.to;

  useEffect(() => {
    setAcknowledged(false);

    if (from === '' || to === '' || unchanged) {
      setQuote(undefined);
      setQuoteProblem(undefined);
      return;
    }

    asked.current += 1;
    const mine = asked.current;

    const waiting = setTimeout(() => {
      quoteChange(entry.requestId, from, to)
        .then((next) => {
          if (mine === asked.current) {
            setQuote(next);
            setQuoteProblem(undefined);
          }
        })
        .catch((error: unknown) => {
          if (mine !== asked.current) {
            return;
          }

          if (isNotSignedIn(error)) {
            onSignedOut();
            return;
          }

          setQuote(undefined);
          setQuoteProblem(problemFrom(error));
        });
    }, 300);

    return () => {
      clearTimeout(waiting);
    };
  }, [entry.requestId, from, to, unchanged, onSignedOut]);

  const shortNotice = quote?.warnings.some((warning) => warning.code === 'SHORT_NOTICE') === true;
  const ready = quote !== undefined && (!shortNotice || acknowledged);

  const change = () => {
    setBusy(true);
    setRefusal(undefined);

    changeRequestDates(entry.requestId, { from, to, acknowledgesShortNotice: acknowledged })
      .then(onChanged)
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
      title="Edit request"
      tags={<span className="tag">{entry.typeName}</span>}
      onClose={onClose}
      actions={
        <span className="modal-actions-end">
          <button type="button" className="linkish" disabled={busy} onClick={onClose}>
            {unchanged ? 'Done' : 'Cancel'}
          </button>
          <button type="button" className="primary" disabled={busy || !ready} onClick={change}>
            {busy ? 'Saving…' : 'Save new dates'}
          </button>
        </span>
      }
    >
      <h3 className="edit-heading">Dates</h3>
      <p className="muted">
        Now {period(entry.from, entry.to)}, {inDays(entry.days)}. New dates send the request back to
        its first approver.
      </p>

      <div className="dates">
        <label>
          First day
          <input
            type="date"
            value={from}
            disabled={busy}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </label>
        <label>
          Last day
          <input
            type="date"
            value={to}
            min={from}
            disabled={busy}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </label>
      </div>

      {quoteProblem === undefined ? null : <Notice problem={quoteProblem} />}

      {quote === undefined ? null : (
        <div className="change-quote" aria-live="polite">
          <p>
            <strong>{inDays(quote.days)}</strong> ({entry.countingBasisLabel.toLowerCase()}),
            leaving <strong>{days(quote.availableAfter)}</strong> in the balance.
          </p>
          {quote.warnings
            .filter((warning) => warning.code !== 'SHORT_NOTICE')
            .map((warning) => (
              <p key={warning.code} className="notice warning">
                {warning.message}
              </p>
            ))}
        </div>
      )}

      {!shortNotice ? null : (
        <label className="acknowledge">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(event) => {
              setAcknowledged(event.target.checked);
            }}
          />
          <span>
            <strong>This is short notice.</strong>I understand the approvers may push back.
          </span>
        </label>
      )}

      {refusal === undefined ? null : <Notice problem={refusal} />}

      <h3 className="edit-heading">Attachments</h3>
      <p className="muted">Files are saved as soon as you add or remove them.</p>
      <AttachedFiles
        requestId={entry.requestId}
        canAttach
        canRemove
        startOpen
        onSignedOut={onSignedOut}
      />
    </Modal>
  );
}
