import { useCallback, useEffect, useState } from 'react';
import {
  addPlan,
  changePlan,
  isNotSignedIn,
  myPlans,
  type Plan,
  type PlanBook,
  type PlanFields,
  type RequestableLeaveType,
  removePlan,
  requestForm,
} from '../../api';
import { EditButton, RemoveButton } from '../../ActionButtons';
import { days, inDays, period } from '../../format';
import { Icon, iconForLeaveType } from '../../Icon';
import { Modal } from '../../Modal';
import { Notice, type Problem, problemFrom } from '../../problem';

/**
 * Leave I am thinking of taking. Holds nothing and goes to nobody; my department, my manager
 * and HR see the dates on Who is away, so everybody can plan around everybody.
 */
export function MyPlansPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [book, setBook] = useState<PlanBook | undefined>(undefined);
  const [types, setTypes] = useState<RequestableLeaveType[]>([]);
  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  /** The plan being edited, `null` for a new one, `undefined` for none. */
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined);

  const failed = useCallback(
    (error: unknown) => {
      if (isNotSignedIn(error)) {
        onSignedOut();
        return;
      }

      setProblem(problemFrom(error));
    },
    [onSignedOut],
  );

  const load = useCallback(() => {
    setLoading(true);

    myPlans(yearId)
      .then((next) => {
        setBook(next);
        setProblem(undefined);
      })
      .catch(failed)
      .finally(() => {
        setLoading(false);
      });
  }, [yearId, failed]);

  useEffect(load, [load]);

  useEffect(() => {
    requestForm()
      .then((form) => {
        setTypes(form.types);
      })
      .catch(failed);
  }, [failed]);

  if (book === undefined) {
    return (
      <div className="page">
        {loading ? (
          <div className="skeleton is-tall" />
        ) : problem === undefined ? null : (
          <Notice problem={problem} retrying={loading} onRetry={load} />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="pagehead">
        <p className="muted">
          Leave you are thinking of taking. Your department, your manager and HR see the dates on
          Who is away. Nothing is held or sent for approval.
        </p>

        <div className="controls">
          {book.years.length < 2 ? null : (
            <label>
              <span className="visually-hidden">Leave year</span>
              <select
                value={book.year.id}
                onChange={(event) => {
                  setYearId(event.target.value);
                }}
              >
                {book.years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="primary add-plan"
            onClick={() => {
              setEditing(null);
            }}
          >
            <Icon name="plus" />
            Add a plan
          </button>
        </div>
      </div>

      {problem === undefined ? null : (
        <Notice problem={problem} retrying={loading} onRetry={load} />
      )}

      {book.totals.length === 0 ? null : (
        <ul className="summary-cards">
          {book.totals.map((total) => (
            <li key={total.leaveTypeId} className="summary-card">
              <div className="summary-card-head">
                <span className="chip">
                  <Icon name={iconForLeaveType(total.typeName)} />
                </span>
                <h3>{total.typeName}</h3>
              </div>
              <p className={total.over ? 'summary-figure overdrawn' : 'summary-figure'}>
                <b>{days(total.planned)}</b>
                <span>
                  {total.available === null
                    ? 'days planned'
                    : `days planned of ${days(total.available)} left`}
                </span>
              </p>
              {total.over && total.available !== null ? (
                <p className="plan-over">
                  That is {inDays(total.planned - total.available)} more than you have left. You can
                  still plan it; a request would need the days.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <section className="board">
        <div className="board-head">
          <h2>Plans in {book.year.label}</h2>
        </div>

        {book.plans.length === 0 ? (
          <div className="empty-state">
            <Icon name="holiday" />
            <p>
              No plans yet. Add the leave you are thinking of taking, so your team can plan around
              it.
            </p>
          </div>
        ) : (
          <div className="report-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Dates</th>
                  <th scope="col">Leave</th>
                  <th scope="col">Note</th>
                  <th scope="col" className="is-action">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {book.plans.map((plan) => (
                  <PlanRow
                    key={plan.planId}
                    plan={plan}
                    onEdit={() => {
                      setEditing(plan);
                    }}
                    onRemoved={load}
                    onFailed={failed}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing === undefined ? null : (
        <PlanForm
          plan={editing}
          types={types}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
          onClose={() => {
            setEditing(undefined);
          }}
          onSignedOut={onSignedOut}
        />
      )}
    </div>
  );
}

function PlanRow({
  plan,
  onEdit,
  onRemoved,
  onFailed,
}: {
  plan: Plan;
  onEdit: () => void;
  onRemoved: () => void;
  onFailed: (error: unknown) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const ask = new URLSearchParams({
    leaveTypeId: plan.leaveTypeId,
    from: plan.from,
    to: plan.to,
    plan: plan.planId,
  });

  return (
    <tr>
      <td className="when">
        <span>{period(plan.from, plan.to)}</span>
        <small>
          {inDays(plan.days)} {plan.countingBasisLabel.toLowerCase()}
        </small>
      </td>
      <td>{plan.typeName}</td>
      <td className="plan-note">{plan.note ?? <span className="muted">No note</span>}</td>
      <td className="is-action">
        {confirming ? (
          <span className="row-actions">
            <button
              type="button"
              className="linkish is-danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                removePlan(plan.planId)
                  .then(onRemoved)
                  .catch(onFailed)
                  .finally(() => {
                    setBusy(false);
                    setConfirming(false);
                  });
              }}
            >
              {busy ? 'Removing…' : 'Yes, remove'}
            </button>
            <button
              type="button"
              className="linkish"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </button>
          </span>
        ) : (
          <span className="row-actions">
            <a className="button-link" href={`#/ask?${ask.toString()}`}>
              <Icon name="ask" />
              Ask for this
            </a>
            <EditButton
              label={`Edit the plan for ${period(plan.from, plan.to)}`}
              onClick={onEdit}
            />
            <RemoveButton
              label={`Remove the plan for ${period(plan.from, plan.to)}`}
              onClick={() => {
                setConfirming(true);
              }}
            />
          </span>
        )}
      </td>
    </tr>
  );
}

/** Adding a plan, or changing one. */
function PlanForm({
  plan,
  types,
  onSaved,
  onClose,
  onSignedOut,
}: {
  plan: Plan | null;
  types: RequestableLeaveType[];
  onSaved: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [fields, setFields] = useState<PlanFields>({
    leaveTypeId: plan?.leaveTypeId ?? types[0]?.leaveTypeId ?? '',
    from: plan?.from ?? '',
    to: plan?.to ?? '',
    note: plan?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Problem | undefined>(undefined);

  const set = (field: keyof PlanFields) => (value: string) => {
    setFields((was) => ({ ...was, [field]: value }));
  };

  const save = () => {
    setBusy(true);
    setRefusal(undefined);

    (plan === null ? addPlan(fields) : changePlan(plan.planId, fields))
      .then(onSaved)
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
      title={plan === null ? 'Add a plan' : 'Edit plan'}
      onClose={onClose}
      actions={
        <span className="modal-actions-end">
          <button type="button" className="linkish" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || fields.from === '' || fields.to === ''}
            onClick={save}
          >
            {busy ? 'Saving…' : 'Save plan'}
          </button>
        </span>
      }
    >
      {refusal === undefined ? null : <Notice problem={refusal} />}

      <label>
        Leave
        <select
          value={fields.leaveTypeId}
          disabled={busy}
          aria-invalid={refusal?.field === 'leaveTypeId' ? true : undefined}
          onChange={(event) => {
            set('leaveTypeId')(event.target.value);
          }}
        >
          {types.map((type) => (
            <option key={type.leaveTypeId} value={type.leaveTypeId}>
              {type.name}
            </option>
          ))}
        </select>
      </label>

      <div className="dates">
        <label>
          First day
          <input
            type="date"
            value={fields.from}
            disabled={busy}
            aria-invalid={refusal?.field === 'from' ? true : undefined}
            onChange={(event) => {
              set('from')(event.target.value);
            }}
          />
        </label>
        <label>
          Last day
          <input
            type="date"
            value={fields.to}
            min={fields.from}
            disabled={busy}
            aria-invalid={refusal?.field === 'to' ? true : undefined}
            onChange={(event) => {
              set('to')(event.target.value);
            }}
          />
        </label>
      </div>

      <label>
        Note, if you want one
        <textarea
          rows={3}
          value={fields.note}
          disabled={busy}
          aria-invalid={refusal?.field === 'note' ? true : undefined}
          onChange={(event) => {
            set('note')(event.target.value);
          }}
        />
        <small className="muted">Only you see this note. Others see the dates.</small>
      </label>
    </Modal>
  );
}
