import { useCallback, useEffect, useState } from 'react';
import {
  type AuditChange,
  type AuditLog,
  type AuditLogEntry,
  type AuditRecordOption,
  auditRecordsOf,
  type AuditSearch,
  isNotSignedIn,
  searchAuditLog,
} from '../../api';
import { moment, momentDate, momentTime } from '../../format';
import { Icon } from '../../Icon';
import { Modal } from '../../Modal';
import { Notice, type Problem, problemFrom } from '../../problem';
import { StatTiles } from '../../StatTiles';

/** Who changed what, searched by record, event and date. Read only. NFR AUD 01, NFR AUD 02. */

type Action = AuditLogEntry['action'];

const EVENTS: Record<Action, { word: string; tone: string }> = {
  CREATE: { word: 'Created', tone: 'is-approved' },
  UPDATE: { word: 'Changed', tone: 'is-submitted' },
  DELETE: { word: 'Removed', tone: 'is-refused' },
};

const PAGE_SIZES = [25, 50, 100];

/** Field names listed in a row before the rest are counted. */
const FIELDS_IN_ROW = 3;

export function AuditLogPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [searched, setSearched] = useState<AuditSearch>({});
  /** The typed id, applied on Enter or leaving the box rather than on every key. */
  const [typedId, setTypedId] = useState('');
  const [log, setLog] = useState<AuditLog | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  /** The chosen kind's records, where there is a list of them worth offering. */
  const [records, setRecords] = useState<AuditRecordOption[] | undefined>(undefined);
  const [needle, setNeedle] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [pageAt, setPageAt] = useState(0);
  const [opened, setOpened] = useState<AuditLogEntry | undefined>(undefined);

  const entity = searched.entity ?? '';
  const pickable = log?.entities.find((one) => one.name === entity)?.pickable === true;

  const load = useCallback(() => {
    setLoading(true);

    searchAuditLog(searched)
      .then((found) => {
        setLog(found);
        setProblem(undefined);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setProblem(problemFrom(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [searched, onSignedOut]);

  useEffect(load, [load]);

  /* Refetched when the kind changes; a kind with no list clears it, so the id box comes back. */
  useEffect(() => {
    if (!pickable) {
      setRecords(undefined);
      return;
    }

    let current = true;

    auditRecordsOf(entity)
      .then((found) => {
        if (current) {
          setRecords(found);
        }
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        // Falls back to the id box; the search still works without the picker.
        if (current) {
          setRecords(undefined);
        }
      });

    return () => {
      current = false;
    };
  }, [entity, pickable, onSignedOut]);

  const search = (next: AuditSearch) => {
    setSearched((was) => ({ ...was, ...next }));
    setPageAt(0);
  };

  const matching = log === undefined ? [] : log.entries.filter((entry) => matches(entry, needle));
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(pageAt, pages - 1);
  const shown = matching.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="page">
      <div className="pagehead">
        <p className="muted">
          Every change to a record, newest first. Nothing here can be changed, by anybody.
        </p>
      </div>

      <StatTiles
        stats={
          log === undefined
            ? undefined
            : [
                { figure: log.tally.total, label: 'Changes in all', icon: 'history' },
                { figure: log.tally.today, label: 'Today', icon: 'balances', tone: 'blue' },
                { figure: log.tally.thisWeek, label: 'This week', icon: 'holiday', tone: 'green' },
                {
                  figure: log.tally.thisMonth,
                  label: 'This month',
                  icon: 'report',
                  tone: 'violet',
                },
              ]
        }
      />

      <form
        className="filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          search({ entityId: typedId.trim() });
        }}
      >
        <label className="filter-search">
          <span className="visually-hidden">Filter what is shown</span>
          <Icon name="search" />
          <input
            type="search"
            value={needle}
            placeholder="Filter what is shown…"
            onChange={(event) => {
              setNeedle(event.target.value);
              setPageAt(0);
            }}
          />
        </label>

        <label>
          <span className="visually-hidden">Kind of record</span>
          <select
            value={entity}
            onChange={(event) => {
              // An id belongs to its kind, so a new kind drops it.
              setTypedId('');
              search({ entity: event.target.value, entityId: '' });
            }}
          >
            <option value="">All records</option>
            {log?.entities.map((one) => (
              <option key={one.name} value={one.name}>
                {one.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="visually-hidden">Which one</span>
          {records === undefined ? (
            <input
              type="text"
              inputMode="numeric"
              value={typedId}
              disabled={entity === ''}
              placeholder={entity === '' ? 'Pick a record first' : 'Any id, then Enter'}
              aria-invalid={problem?.field === 'entityId' ? true : undefined}
              onChange={(event) => {
                setTypedId(event.target.value);
              }}
              onBlur={() => {
                if (typedId.trim() !== (searched.entityId ?? '')) {
                  search({ entityId: typedId.trim() });
                }
              }}
            />
          ) : (
            <select
              value={searched.entityId ?? ''}
              aria-invalid={problem?.field === 'entityId' ? true : undefined}
              onChange={(event) => {
                search({ entityId: event.target.value });
              }}
            >
              <option value="">Every one</option>
              {records.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label}
                </option>
              ))}
            </select>
          )}
        </label>

        <label>
          <span className="visually-hidden">Event</span>
          <select
            value={searched.action ?? ''}
            onChange={(event) => {
              search({ action: event.target.value as AuditSearch['action'] });
            }}
          >
            <option value="">All events</option>
            {(Object.keys(EVENTS) as Action[]).map((action) => (
              <option key={action} value={action}>
                {EVENTS[action].word}
              </option>
            ))}
          </select>
        </label>

        <label className="field-inline">
          <span>From</span>
          <input
            type="date"
            value={searched.from ?? ''}
            onChange={(event) => {
              search({ from: event.target.value });
            }}
          />
        </label>

        <label className="field-inline">
          <span>To</span>
          <input
            type="date"
            value={searched.to ?? ''}
            aria-invalid={problem?.field === 'to' ? true : undefined}
            onChange={(event) => {
              search({ to: event.target.value });
            }}
          />
        </label>
      </form>

      {problem === undefined ? null : (
        <Notice problem={problem} retrying={loading} onRetry={load} />
      )}

      {log === undefined ? (
        problem === undefined ? (
          <div className="skeleton is-tall" />
        ) : null
      ) : (
        <section className="board" aria-busy={loading}>
          <div className="board-head">
            <h2>Changes</h2>
            <span className="muted">
              {log.moreThanShown
                ? `The newest ${String(log.longestSearch)}. Narrow the search to reach older ones.`
                : `${String(log.entries.length)} found`}
            </span>
          </div>

          {shown.length === 0 ? (
            <p className="board-empty muted">Nothing in the log matches that search.</p>
          ) : (
            <div className="report-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">What happened</th>
                    <th scope="col">Record</th>
                    <th scope="col">Event</th>
                    <th scope="col">By</th>
                    <th scope="col" className="is-action">
                      <span className="visually-hidden">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry) => (
                    <tr
                      key={entry.id}
                      className="is-openable"
                      onClick={() => {
                        setOpened(entry);
                      }}
                    >
                      <td className="when">
                        <span>{momentDate(entry.occurredAt)}</span>
                        <small>{momentTime(entry.occurredAt)}</small>
                      </td>
                      <td className="what">
                        <span>{describe(entry)}</span>
                        <small>{inBrief(entry)}</small>
                      </td>
                      <td>
                        <span className="tag">{entry.entityLabel}</span>
                      </td>
                      <td>
                        <EventTag action={entry.action} />
                      </td>
                      <td>{entry.actor}</td>
                      <td className="is-action">
                        <button
                          type="button"
                          className="iconic linkish"
                          title="See what changed"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpened(entry);
                          }}
                        >
                          <Icon name="eye" />
                          <span className="visually-hidden">See what changed</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pager">
            <label className="field-inline">
              <span>Rows</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPageAt(0);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <span className="muted">
              {matching.length === 0
                ? 'None'
                : `${String(page * pageSize + 1)} to ${String(page * pageSize + shown.length)} of ${String(matching.length)}`}
            </span>

            <button
              type="button"
              className="iconic"
              disabled={page === 0}
              onClick={() => {
                setPageAt(page - 1);
              }}
            >
              <Icon name="back" />
              <span className="visually-hidden">Newer</span>
            </button>
            <button
              type="button"
              className="iconic is-next"
              disabled={page >= pages - 1}
              onClick={() => {
                setPageAt(page + 1);
              }}
            >
              <Icon name="back" />
              <span className="visually-hidden">Older</span>
            </button>
          </div>
        </section>
      )}

      {opened === undefined ? null : (
        <EntryDetails
          entry={opened}
          onClose={() => {
            setOpened(undefined);
          }}
        />
      )}
    </div>
  );
}

function EventTag({ action }: { action: Action }) {
  return <span className={`tag status ${EVENTS[action].tone}`}>{EVENTS[action].word}</span>;
}

function EntryDetails({ entry, onClose }: { entry: AuditLogEntry; onClose: () => void }) {
  return (
    <Modal title={describe(entry)} tags={<EventTag action={entry.action} />} onClose={onClose}>
      <dl className="entry-facts">
        <div>
          <dt>When</dt>
          <dd>{moment(entry.occurredAt)}</dd>
        </div>
        <div>
          <dt>By</dt>
          <dd>{entry.actor}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd>
            {entry.entityLabel} <code>{entry.entityId}</code>
          </dd>
        </div>
      </dl>

      <Changes action={entry.action} changes={entry.changes} />
    </Modal>
  );
}

function Changes({ action, changes }: { action: Action; changes: AuditChange[] }) {
  if (changes.length === 0) {
    return <p className="muted">No field moved.</p>;
  }

  // A create has nothing before it, and a removal nothing after.
  const hasWas = action !== 'CREATE';
  const hasNow = action !== 'DELETE';

  return (
    <div className="report-table">
      <table className="data-table change-table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            {hasWas ? <th scope="col">Was</th> : null}
            {hasNow ? <th scope="col">{action === 'CREATE' ? 'Set to' : 'Now'}</th> : null}
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.field}>
              <th scope="row">{fieldName(change.field)}</th>
              {hasWas ? (
                <td className="was">
                  <Value value={change.from} />
                </td>
              ) : null}
              {hasNow ? (
                <td>
                  <Value value={change.to} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="empty">nothing</span>;
  }

  return <>{typeof value === 'string' ? value : JSON.stringify(value)}</>;
}

/** "Employee changed". */
function describe(entry: AuditLogEntry): string {
  return `${entry.entityLabel} ${EVENTS[entry.action].word.toLowerCase()}`;
}

/** The fields that moved, for a change; the id, for a record made or removed. */
function inBrief(entry: AuditLogEntry): string {
  if (entry.action !== 'UPDATE') {
    return `id ${entry.entityId}`;
  }

  if (entry.changes.length === 0) {
    return 'No field moved';
  }

  const named = entry.changes.slice(0, FIELDS_IN_ROW).map((change) => fieldName(change.field));
  const rest = entry.changes.length - named.length;

  return rest > 0 ? `${named.join(', ')} and ${String(rest)} more` : named.join(', ');
}

/** `job_title` as "Job title". */
function fieldName(field: string): string {
  const words = field.replace(/_/g, ' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function matches(entry: AuditLogEntry, needle: string): boolean {
  const asked = needle.trim().toLowerCase();

  if (asked === '') {
    return true;
  }

  return [
    describe(entry),
    entry.actor,
    entry.entityId,
    ...entry.changes.map((change) => fieldName(change.field)),
  ].some((text) => text.toLowerCase().includes(asked));
}
