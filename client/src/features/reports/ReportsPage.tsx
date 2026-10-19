import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  type CarriedOverReport,
  carriedOverReport,
  type Desk,
  isNotSignedIn,
  type LeaveTakenReport,
  leaveTakenReport,
  type LeaveUsageReport,
  type LiabilityLine,
  type LiabilityReport,
  liabilityReport,
  type OverdueRequestsReport,
  overdueRequestsReport,
  type PersonLine,
  type ReportChoices,
  reportExportPath,
  type ReportQuery,
  usageReport,
  type Year,
} from '../../api';
import { ExportButtons } from '../../ExportButtons';
import { day, days, period } from '../../format';
import { Icon, iconForLeaveType, type IconName } from '../../Icon';
import { Notice, type Problem, problemFrom } from '../../problem';

/** HR's reports on leave across the company. FR 63, FR 58, FR 64. */

const REPORTS = [
  {
    id: 'liability',
    path: 'liability',
    label: 'Leave liability',
    blurb: 'Days granted, taken and still owed, by leave type and department.',
  },
  {
    id: 'taken',
    path: 'leave-taken',
    label: 'Leave taken',
    blurb: 'Approved leave by type, counted in the month it starts.',
  },
  {
    id: 'overdue',
    path: 'overdue-requests',
    label: 'Overdue requests',
    blurb: 'Requests waiting longer than the turnaround for a decision.',
  },
  {
    id: 'usage',
    path: 'usage',
    label: 'Zero or excessive use',
    blurb: 'People who took none of their leave, or more than they were given.',
  },
  {
    id: 'carried',
    path: 'carried-over',
    label: 'Carried over',
    blurb: 'Days carried into the year, by leave type and by person. Carry over is uncapped.',
  },
] as const;

type ReportId = (typeof REPORTS)[number]['id'];

type Loaded =
  | { id: 'liability'; report: LiabilityReport }
  | { id: 'taken'; report: LeaveTakenReport }
  | { id: 'overdue'; report: OverdueRequestsReport }
  | { id: 'usage'; report: LeaveUsageReport }
  | { id: 'carried'; report: CarriedOverReport };

interface Asked {
  yearId?: string;
  from: string;
  to: string;
  turnaround: string;
  departmentId: string;
  leaveTypeId: string;
}

const DESKS: Record<Desk, string> = { MANAGER: 'Line manager', HR: 'HR', CEO: 'Chief Executive' };

export function ReportsPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [chosen, setChosen] = useState<ReportId>('liability');
  const [years, setYears] = useState<Year[]>([]);
  const [choices, setChoices] = useState<ReportChoices>({ departments: [], types: [] });
  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [turnaround, setTurnaround] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const asked: Asked = { yearId, from, to, turnaround, departmentId, leaveTypeId };
  const query = queryFor(chosen, asked);

  const load = useCallback(() => {
    setLoading(true);

    reportFor(chosen, queryFor(chosen, { yearId, from, to, turnaround, departmentId, leaveTypeId }))
      .then((next) => {
        setLoaded(next);
        setChoices(next.report.choices);
        setProblem(undefined);

        if ('years' in next.report) {
          setYears(next.report.years);
          setYearId((was) => was ?? (next.report as { year: Year }).year.id);
        }
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
  }, [chosen, yearId, from, to, turnaround, departmentId, leaveTypeId, onSignedOut]);

  useEffect(load, [load]);

  const resetAll = () => {
    // No year means the server's default, the current one.
    setYearId(undefined);
    setFrom('');
    setTo('');
    setTurnaround('');
    setDepartmentId('');
    setLeaveTypeId('');
  };

  const showing = loaded?.id === chosen ? loaded : undefined;
  const overAYear = chosen === 'liability' || chosen === 'usage' || chosen === 'carried';
  const report = REPORTS.find((one) => one.id === chosen) ?? REPORTS[0];

  return (
    <div className="page">
      <div className="pagehead">
        <p className="muted">
          Leave across the company, for HR. People who have left are not counted in the balance
          reports; their figure is on the Leavers screen.
        </p>
      </div>

      <div className="report-tabs">
        {REPORTS.map((one) => (
          <button
            key={one.id}
            type="button"
            className="report-tab"
            aria-pressed={one.id === chosen}
            onClick={() => {
              setChosen(one.id);
            }}
          >
            {one.label}
          </button>
        ))}
      </div>
      <p className="muted report-blurb">{report.blurb}</p>

      <section className="board filters-card">
        <div className="board-head">
          <h2>Filters</h2>
          <span className="board-head-end">
            <button type="button" className="linkish reset-all" onClick={resetAll}>
              <Icon name="again" />
              Reset all
            </button>
            <ExportButtons
              path={reportExportPath(report.path, query)}
              onSignedOut={onSignedOut}
              onProblem={setProblem}
            />
          </span>
        </div>

        <div className="filter-grid">
          {overAYear && years.length > 0 ? (
            <label>
              Leave year
              <select
                value={yearId ?? ''}
                onChange={(event) => {
                  setYearId(event.target.value);
                }}
              >
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label}
                    {year.isClosed ? ' (closed)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            Department
            <select
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
              }}
            >
              <option value="">All departments</option>
              {choices.departments.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Leave type
            <select
              value={leaveTypeId}
              onChange={(event) => {
                setLeaveTypeId(event.target.value);
              }}
            >
              <option value="">All leave types</option>
              {choices.types.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>

          {chosen === 'taken' || chosen === 'overdue' ? (
            <>
              <label>
                {chosen === 'overdue' ? 'Submitted from' : 'From'}
                <input
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                  }}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                  }}
                />
              </label>
            </>
          ) : null}

          {chosen === 'overdue' ? (
            <label>
              Turnaround, in days
              <input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder={showing?.id === 'overdue' ? String(showing.report.turnaroundDays) : ''}
                value={turnaround}
                onChange={(event) => {
                  setTurnaround(event.target.value);
                }}
              />
            </label>
          ) : null}
        </div>
      </section>

      {problem === undefined ? null : (
        <Notice problem={problem} retrying={loading} onRetry={load} />
      )}

      {showing === undefined ? (
        loading ? (
          <Skeletons />
        ) : null
      ) : (
        <div className="report-body" aria-busy={loading}>
          <Report loaded={showing} />
        </div>
      )}
    </div>
  );
}

function Report({ loaded }: { loaded: Loaded }) {
  switch (loaded.id) {
    case 'liability':
      return <Liability report={loaded.report} />;
    case 'taken':
      return <LeaveTaken report={loaded.report} />;
    case 'overdue':
      return <Overdue report={loaded.report} />;
    case 'usage':
      return <Usage report={loaded.report} />;
    case 'carried':
      return <CarriedOver report={loaded.report} />;
  }
}

/* ------------------------------------------------------------------ liability */

function Liability({ report }: { report: LiabilityReport }) {
  const headcount = report.departments.reduce((sum, one) => sum + one.headcount, 0);

  return (
    <>
      <SummaryCards>
        <SummaryCard
          icon="people"
          title="People counted"
          figure={String(headcount)}
          caption={`in ${String(report.departments.length)} ${report.departments.length === 1 ? 'department' : 'departments'}`}
        />
        {report.company.map((line) => (
          <SummaryCard
            key={line.leaveTypeId}
            icon={iconForLeaveType(line.name)}
            title={line.name}
            figure={days(line.unused)}
            caption={`${line.countingBasisLabel.toLowerCase()} unused`}
            overdrawn={line.unused < 0}
            parts={[
              { label: 'Granted', figure: days(line.entitled), tone: 'blue' },
              { label: 'Taken', figure: days(line.taken), tone: 'green' },
              { label: 'Held', figure: days(line.pending), tone: 'sky' },
            ]}
          />
        ))}
      </SummaryCards>

      <Board title="The company" aside={report.year.label}>
        <LiabilityTable lines={report.company} />
      </Board>

      {report.departments.map((department) => (
        <Board
          key={department.departmentId}
          title={department.name}
          aside={`${String(department.headcount)} ${department.headcount === 1 ? 'person' : 'people'}`}
        >
          <LiabilityTable lines={department.lines} />
        </Board>
      ))}
    </>
  );
}

function LiabilityTable({ lines }: { lines: LiabilityLine[] }) {
  if (lines.length === 0) {
    return <Empty said="No leave granted here in this year." />;
  }

  return (
    <Table
      head={['Leave type', 'People', 'Granted', 'Carried', 'Adjusted', 'Taken', 'Held', 'Unused']}
    >
      {lines.map((line) => (
        <tr key={line.leaveTypeId}>
          <TypeCell name={line.name} basis={line.countingBasisLabel} />
          <td>{line.people}</td>
          <td>{days(line.entitled)}</td>
          <td>{days(line.carriedOver)}</td>
          <td>{days(line.adjustment)}</td>
          <td>{days(line.taken)}</td>
          <td>{days(line.pending)}</td>
          <td className={line.unused < 0 ? 'overdrawn' : undefined}>
            <b>{days(line.unused)}</b>
          </td>
        </tr>
      ))}
    </Table>
  );
}

/* ----------------------------------------------------------------- leave taken */

function LeaveTaken({ report }: { report: LeaveTakenReport }) {
  return (
    <>
      <SummaryCards>
        {report.lines.map((line) => (
          <SummaryCard
            key={line.leaveTypeId}
            icon={iconForLeaveType(line.name)}
            title={line.name}
            figure={days(line.days)}
            caption={`${line.countingBasisLabel.toLowerCase()}, ${String(line.requests)} ${line.requests === 1 ? 'request' : 'requests'}`}
          >
            <MonthBars
              months={report.months}
              values={line.byMonth}
              unit={line.countingBasisLabel}
            />
          </SummaryCard>
        ))}
      </SummaryCards>

      <Board title="Month by month" aside={period(report.from, report.to)}>
        {report.lines.length === 0 ? (
          <Empty said="No approved leave starts in this period." />
        ) : (
          <Table head={['Leave type', ...report.months.map(monthLabel), 'Days', 'Requests']}>
            {report.lines.map((line) => (
              <tr key={line.leaveTypeId}>
                <TypeCell name={line.name} basis={line.countingBasisLabel} />
                {line.byMonth.map((figure, index) => (
                  <td key={report.months[index]}>{days(figure)}</td>
                ))}
                <td>
                  <b>{days(line.days)}</b>
                </td>
                <td>{line.requests}</td>
              </tr>
            ))}
          </Table>
        )}
      </Board>
    </>
  );
}

/**
 * Days per month as small columns, one series in the accent. The table under it carries every
 * figure, so the hover readout only adds to it.
 */
function MonthBars({ months, values, unit }: { months: string[]; values: number[]; unit: string }) {
  const top = Math.max(0, ...values);

  if (months.length === 0) {
    return null;
  }

  return (
    <figure className="month-bars">
      <div className="month-bars-plot" role="img" aria-label="Days by month, as in the table below">
        {values.map((value, index) => {
          const label = `${monthLabel(months[index] ?? '')}: ${days(value)} ${unit.toLowerCase()}`;

          return (
            <span key={months[index]} className="month-bars-slot" data-tip={label}>
              {value > 0 ? (
                <span
                  className="month-bars-bar"
                  style={{ height: `${String(Math.max(6, (value / top) * 100))}%` }}
                />
              ) : null}
            </span>
          );
        })}
      </div>
      <figcaption>
        <span>{monthLabel(months[0] ?? '')}</span>
        <span>{monthLabel(months[months.length - 1] ?? '')}</span>
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------------- overdue */

function Overdue({ report }: { report: OverdueRequestsReport }) {
  const longest = report.requests.reduce((most, one) => Math.max(most, one.daysWaiting), 0);
  const waitingOn = (desk: Desk | null) =>
    String(report.requests.filter((one) => one.awaiting === desk).length);
  const nobody = report.requests.some((one) => one.awaiting === null);

  return (
    <>
      <SummaryCards>
        <SummaryCard
          icon="approvals"
          title="Waiting too long"
          figure={String(report.requests.length)}
          caption={`longer than ${String(report.turnaroundDays)} days, as at ${day(report.asAt)}`}
        />
        <SummaryCard
          icon="history"
          title="Longest wait"
          figure={String(longest)}
          caption={longest === 1 ? 'day' : 'days'}
        />
        <SummaryCard
          icon="stage"
          title="Waiting on"
          wide
          parts={[
            { label: DESKS.MANAGER, figure: waitingOn('MANAGER'), tone: 'blue' },
            { label: DESKS.HR, figure: waitingOn('HR'), tone: 'green' },
            { label: DESKS.CEO, figure: waitingOn('CEO'), tone: 'sky' },
            ...(nobody
              ? [{ label: 'Nobody to approve', figure: waitingOn(null), tone: 'warn' as const }]
              : []),
          ]}
        />
      </SummaryCards>

      <Board title="Waiting for a decision">
        {report.requests.length === 0 ? (
          <Empty said="Nothing has waited longer than the turnaround." />
        ) : (
          <Table
            head={[
              'Who',
              'Department',
              'Leave',
              'Dates',
              'Days',
              'Asked on',
              'Waiting',
              'Waiting on',
            ]}
            text={[0, 1, 2, 3, 5, 7]}
          >
            {report.requests.map((one) => (
              <tr key={one.requestId}>
                <th scope="row">{one.name}</th>
                <td className="is-text">{one.department}</td>
                <td className="is-text">{one.typeName}</td>
                <td className="is-text">{period(one.from, one.to)}</td>
                <td>{days(one.days)}</td>
                <td className="is-text">{day(one.submittedOn)}</td>
                <td>
                  <b>{one.daysWaiting}</b>
                </td>
                <td className="is-text">
                  {one.awaiting === null ? 'Nobody to approve' : DESKS[one.awaiting]}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Board>
    </>
  );
}

/* ----------------------------------------------------------------------- usage */

function Usage({ report }: { report: LeaveUsageReport }) {
  return (
    <>
      <SummaryCards>
        <SummaryCard
          icon="unpaid"
          title="Took none"
          figure={String(report.zero.length)}
          caption={`given days in ${report.year.label} and took none`}
        />
        <SummaryCard
          icon="up"
          title="Took more than given"
          figure={String(report.excessive.length)}
          caption="taken is more than granted, carried and adjusted"
          overdrawn={report.excessive.length > 0}
        />
      </SummaryCards>

      <Board title="Took none" aside={report.year.label}>
        <People lines={report.zero} empty="Everybody given days has taken some." />
      </Board>

      <Board title="Took more than given" aside={report.year.label}>
        <People lines={report.excessive} empty="Nobody took more than they were given." />
      </Board>
    </>
  );
}

/* --------------------------------------------------------------------- carried */

function CarriedOver({ report }: { report: CarriedOverReport }) {
  return (
    <>
      <SummaryCards>
        {report.totals.length === 0 ? (
          <SummaryCard
            icon="annual"
            title={`Carried into ${report.year.label}`}
            figure="0"
            caption="nothing was carried into this year"
          />
        ) : (
          report.totals.map((total) => (
            <SummaryCard
              key={total.leaveTypeId}
              icon={iconForLeaveType(total.name)}
              title={total.name}
              figure={days(total.carriedOver)}
              caption={`${total.countingBasisLabel.toLowerCase()} carried, by ${String(total.people)} ${total.people === 1 ? 'person' : 'people'}`}
            />
          ))
        )}
      </SummaryCards>

      <Board title="Balances" aside={`carried into ${report.year.label}`}>
        <People lines={report.balances} empty="Nothing was carried into this year." />
      </Board>
    </>
  );
}

/* --------------------------------------------------------------------- shared */

function People({ lines, empty }: { lines: PersonLine[]; empty: string }) {
  if (lines.length === 0) {
    return <Empty said={empty} />;
  }

  return (
    <Table
      head={['Who', 'Department', 'Leave', 'Given', 'Carried', 'Taken', 'Held', 'Left']}
      text={[0, 1, 2]}
    >
      {lines.map((line) => (
        <tr key={`${line.employeeId}-${line.leaveTypeId}`}>
          <th scope="row">{line.name}</th>
          <td className="is-text">{line.department}</td>
          <td className="is-text">{line.typeName}</td>
          <td>{days(line.given)}</td>
          <td>{days(line.carriedOver)}</td>
          <td>{days(line.taken)}</td>
          <td>{days(line.pending)}</td>
          <td className={line.available < 0 ? 'overdrawn' : undefined}>{days(line.available)}</td>
        </tr>
      ))}
    </Table>
  );
}

function SummaryCards({ children }: { children: ReactNode }) {
  return <ul className="summary-cards">{children}</ul>;
}

interface Part {
  label: string;
  figure: string;
  tone: 'blue' | 'green' | 'sky' | 'warn';
}

/** A titled card: a headline figure, its parts as small tiles, or both. */
function SummaryCard({
  icon,
  title,
  figure,
  caption,
  parts,
  overdrawn = false,
  wide = false,
  children,
}: {
  icon: IconName;
  title: string;
  figure?: string;
  caption?: string;
  parts?: Part[];
  overdrawn?: boolean;
  /** Spans two columns, for a card that is only parts. */
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={wide ? 'summary-card is-wide' : 'summary-card'}>
      <div className="summary-card-head">
        <span className="chip">
          <Icon name={icon} />
        </span>
        <h3>{title}</h3>
      </div>

      {figure === undefined ? null : (
        <p className={overdrawn ? 'summary-figure overdrawn' : 'summary-figure'}>
          <b>{figure}</b>
          {caption === undefined ? null : <span>{caption}</span>}
        </p>
      )}

      {parts === undefined ? null : (
        <ul className="summary-parts">
          {parts.map((part) => (
            <li key={part.label} className={`is-${part.tone}`}>
              <b>{part.figure}</b>
              <span>{part.label}</span>
            </li>
          ))}
        </ul>
      )}

      {children}
    </li>
  );
}

function Board({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="board">
      <div className="board-head">
        <h2>{title}</h2>
        {aside === undefined ? null : <span className="muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** Nothing to show, said in the space the table would have taken. */
function Empty({ said }: { said: string }) {
  return (
    <div className="empty-state">
      <Icon name="report" />
      <p>{said}</p>
    </div>
  );
}

/** `text` is which columns hold words, left aligned; the rest are figures. */
function Table({
  head,
  text = [0],
  children,
}: {
  head: string[];
  text?: number[];
  children: ReactNode;
}) {
  return (
    <div className="report-table">
      <table className="data-table is-figures">
        <thead>
          <tr>
            {head.map((label, index) => (
              <th key={label} scope="col" className={text.includes(index) ? 'is-text' : undefined}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TypeCell({ name, basis }: { name: string; basis: string }) {
  return (
    <th scope="row">
      {name}
      <small>{basis}</small>
    </th>
  );
}

/** "Mar 2026" from `2026-03`. */
function monthLabel(month: string): string {
  const written = day(`${month}-01`);

  return written.slice(written.indexOf(' ') + 1);
}

/** Only what the chosen report reads, so the export matches the screen. */
function queryFor(id: ReportId, asked: Asked): ReportQuery {
  const narrowing = { departmentId: asked.departmentId, leaveTypeId: asked.leaveTypeId };

  switch (id) {
    case 'taken':
      return { ...narrowing, from: asked.from, to: asked.to };
    case 'overdue':
      return {
        ...narrowing,
        from: asked.from,
        to: asked.to,
        turnaroundDays: asked.turnaround,
      };
    default:
      return { ...narrowing, leaveYearId: asked.yearId };
  }
}

async function reportFor(id: ReportId, query: ReportQuery): Promise<Loaded> {
  switch (id) {
    case 'liability':
      return { id, report: await liabilityReport(query) };
    case 'taken':
      return { id, report: await leaveTakenReport(query) };
    case 'overdue':
      return { id, report: await overdueRequestsReport(query) };
    case 'usage':
      return { id, report: await usageReport(query) };
    case 'carried':
      return { id, report: await carriedOverReport(query) };
  }
}

function Skeletons() {
  return (
    <>
      <ul className="summary-cards" aria-hidden="true">
        {[0, 1, 2, 3].map((one) => (
          <li key={one} className="skeleton stat-skeleton" />
        ))}
      </ul>
      <div className="skeleton is-tall" />
    </>
  );
}
