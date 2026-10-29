import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CoverPlan, coverFor, isNotSignedIn, nameCover } from '../../api';
import { period } from '../../format';
import { Icon } from '../../Icon';
import { Modal } from '../../Modal';
import { Notice, type Problem, problemFrom } from '../../problem';
import { CoverFields, type CoverDraft, draftOf, partsOf } from './CoverFields';

/**
 * Who covers a request, opened from a button. For the person whose leave it is, their manager
 * and HR, who are the three the server lets name it; anybody else is never shown the button.
 */
export function CoverButton({
  requestId,
  employeeId,
  onSignedOut,
}: {
  requestId: string;
  /** Whose leave, where it is not the reader's own. */
  employeeId?: string;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="button-link"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="people" />
        Cover
      </button>

      {/* Into the body rather than beside the button: the button sits in a card's
          right-aligned foot, and a dialog drawn there inherits its alignment and small buttons. */}
      {open
        ? createPortal(
            <CoverEditor
              requestId={requestId}
              employeeId={employeeId}
              onClose={() => {
                setOpen(false);
              }}
              onSignedOut={onSignedOut}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Who colleagues contact while somebody is away, for one request. #226.
 *
 * Saved as a whole: the server keeps what is unchanged, ends the rest and tells anybody newly
 * named. Naming nobody clears it.
 */
export function CoverEditor({
  requestId,
  employeeId,
  onClose,
  onSignedOut,
}: {
  requestId: string;
  employeeId?: string;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [plan, setPlan] = useState<CoverPlan | undefined>(undefined);
  const [draft, setDraft] = useState<CoverDraft | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    coverFor(requestId)
      .then((next) => {
        setPlan(next);
        setDraft(draftOf(next.parts, next.from, next.to));
        setProblem(undefined);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setProblem(problemFrom(error));
      });
  }, [requestId, onSignedOut]);

  useEffect(load, [load]);

  const save = () => {
    if (plan === undefined || draft === undefined) {
      return;
    }

    setSaving(true);
    setProblem(undefined);
    setSaved(false);

    nameCover(requestId, partsOf(draft, plan.from, plan.to))
      .then((next) => {
        setPlan(next);
        setDraft(draftOf(next.parts, next.from, next.to));
        setSaved(true);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setProblem(problemFrom(error));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <Modal
      title="Cover while away"
      onClose={onClose}
      actions={
        <span className="modal-actions-end">
          <button type="button" className="linkish" disabled={saving} onClick={onClose}>
            {saved ? 'Done' : 'Cancel'}
          </button>
          {plan?.mayChange === true ? (
            <button type="button" className="primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save cover'}
            </button>
          ) : null}
        </span>
      }
    >
      {plan === undefined || draft === undefined ? (
        problem === undefined ? (
          <p className="muted">Loading…</p>
        ) : (
          <Notice problem={problem} onRetry={load} />
        )
      ) : (
        <>
          <p className="muted">
            Leave {period(plan.from, plan.to)}. While it is agreed and under way, the directory
            tells colleagues who to contact instead. Anybody newly named is emailed.
          </p>

          {plan.mayChange ? (
            <CoverFields
              employeeId={employeeId}
              from={plan.from}
              to={plan.to}
              draft={draft}
              disabled={saving}
              onChange={(next) => {
                setDraft(next);
                setSaved(false);
              }}
              onSignedOut={onSignedOut}
            />
          ) : plan.parts.length === 0 ? (
            <p>Nobody was named.</p>
          ) : (
            <ul className="cover-named">
              {plan.parts.map((part) => (
                <li key={`${part.coverId}-${part.from}`}>
                  {part.cover.firstName} {part.cover.lastName}, {period(part.from, part.to)}
                </li>
              ))}
            </ul>
          )}

          {saved ? (
            <p className="notice done" role="status">
              Saved.
            </p>
          ) : null}

          {problem === undefined ? null : <Notice problem={problem} />}
        </>
      )}
    </Modal>
  );
}
