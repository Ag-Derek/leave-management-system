import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  type EmailPreview,
  type EmailWording,
  emailWording,
  type EmailWordingPage as Page,
  isNotSignedIn,
  previewEmail,
  putBackEmailWording,
  rewordEmail,
} from '../../api';
import { sentenceCase } from '../../format';
import { Icon } from '../../Icon';
import { Modal } from '../../Modal';
import { Notice, type Problem, problemFrom } from '../../problem';

/** The wording of every email the system sends, kept by HR. FR 61. */
export function EmailWordingPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [page, setPage] = useState<Page | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [previewing, setPreviewing] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);

  const load = useCallback(() => {
    setLoading(true);

    emailWording()
      .then((next) => {
        setPage(next);
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
  }, [onSignedOut]);

  useEffect(load, [load]);

  const head = (
    <div className="pagehead">
      <p className="muted">
        The words each email goes out in. A change applies to the next email sent; emails already
        sent keep their words.
      </p>
    </div>
  );

  if (page === undefined) {
    return (
      <div className="page">
        {head}
        {problem === undefined ? (
          <div className="skeleton is-tall" />
        ) : (
          <Notice problem={problem} retrying={loading} onRetry={load} />
        )}
      </div>
    );
  }

  const toEdit = page.emails.find((one) => one.name === editing);
  const toPreview = page.emails.find((one) => one.name === previewing);

  const saved = (next: EmailWording, said: string) => {
    setPage({
      ...page,
      emails: page.emails.map((one) => (one.name === next.name ? next : one)),
    });
    setEditing(undefined);
    setDone(said);
  };

  return (
    <div className="page">
      {head}

      <section className="board">
        <div className="board-head">
          <h2>Emails</h2>
          <span className="muted">Press Edit to read all of an email and change what it says.</span>
        </div>

        {done === undefined ? null : (
          <div className="notice done" role="status">
            <p>{done}</p>
          </div>
        )}

        <div className="report-table">
          <table className="data-table wording-table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Sent to</th>
                <th scope="col">Subject line</th>
                <th scope="col" className="is-action">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.emails.map((email) => (
                <tr key={email.name}>
                  <td className="email-name">{email.label}</td>
                  <td className="sent-to">
                    <span className="tag">{sentenceCase(email.readBy)}</span>
                  </td>
                  <td className="wording-words">
                    <span className="clip" title={email.subject}>
                      {email.subject}
                    </span>
                  </td>
                  <td className="is-action">
                    <span className="row-actions">
                      <button
                        type="button"
                        className="iconic linkish"
                        title="Preview"
                        onClick={() => {
                          setPreviewing(email.name);
                        }}
                      >
                        <Icon name="eye" />
                        <span className="visually-hidden">Preview {email.label}</span>
                      </button>
                      <button
                        type="button"
                        className="edit-button"
                        onClick={() => {
                          setDone(undefined);
                          setEditing(email.name);
                        }}
                      >
                        <Icon name="pencil" />
                        Edit<span className="visually-hidden"> {email.label}</span>
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {toEdit === undefined ? null : (
        <WordingForm
          key={toEdit.name}
          email={toEdit}
          longestSubject={page.longestSubject}
          longestBody={page.longestBody}
          onSaved={saved}
          onClose={() => {
            setEditing(undefined);
          }}
          onSignedOut={onSignedOut}
        />
      )}

      {toPreview === undefined ? null : (
        <PreviewDialog
          key={toPreview.name}
          email={toPreview}
          onEdit={() => {
            setPreviewing(undefined);
            setDone(undefined);
            setEditing(toPreview.name);
          }}
          onClose={() => {
            setPreviewing(undefined);
          }}
          onSignedOut={onSignedOut}
        />
      )}
    </div>
  );
}

/** One email's subject and message, its placeholders, and a preview. */
function WordingForm({
  email,
  longestSubject,
  longestBody,
  onSaved,
  onClose,
  onSignedOut,
}: {
  email: EmailWording;
  longestSubject: number;
  longestBody: number;
  onSaved: (email: EmailWording, said: string) => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [preview, setPreview] = useState<EmailPreview | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Problem | undefined>(undefined);

  const subjectBox = useRef<HTMLInputElement | null>(null);
  const bodyBox = useRef<HTMLTextAreaElement | null>(null);
  /** Where a placeholder goes: the box last typed in. */
  const lastFocused = useRef<'subject' | 'body'>('body');

  const dirty = subject !== email.subject || body !== email.body;
  const formId = `wording-${email.name}`;

  const used = placeholdersIn(`${subject}\n${body}`);
  const inUse = email.placeholders.filter((one) => used.has(one.name));
  const notInUse = email.placeholders.filter((one) => !used.has(one.name));

  function run<T>(call: Promise<T>, done: (answer: T) => void): void {
    setBusy(true);
    setRefusal(undefined);

    call
      .then(done)
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
  }

  function insert(placeholder: string): void {
    const text = `{{${placeholder}}}`;
    const inSubject = lastFocused.current === 'subject';
    const box = inSubject ? subjectBox.current : bodyBox.current;
    const value = inSubject ? subject : body;
    const start = box?.selectionStart ?? value.length;
    const end = box?.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);

    if (inSubject) {
      setSubject(next);
    } else {
      setBody(next);
    }

    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  /** Puts the message box's text and selection, then hands focus back to it. */
  function rewrite(next: string, from: number, to: number): void {
    setBody(next);

    requestAnimationFrame(() => {
      bodyBox.current?.focus();
      bodyBox.current?.setSelectionRange(from, to);
    });
  }

  /** Wraps the selection in a marker, or unwraps it where it is wrapped already. */
  function wrap(marker: string): void {
    const box = bodyBox.current;
    if (box === null) {
      return;
    }

    const { selectionStart: start, selectionEnd: end } = box;
    const width = marker.length;
    const isWrapped =
      body.slice(start - width, start) === marker &&
      body.slice(end, end + width) === marker &&
      // `_` inside `__` is underline, not italic.
      body.charAt(start - width - 1) !== marker.charAt(0) &&
      body.charAt(end + width) !== marker.charAt(0);

    if (isWrapped) {
      rewrite(
        body.slice(0, start - width) + body.slice(start, end) + body.slice(end + width),
        start - width,
        end - width,
      );
      return;
    }

    rewrite(
      body.slice(0, start) + marker + body.slice(start, end) + marker + body.slice(end),
      start + width,
      end + width,
    );
  }

  /** Makes the lines under the selection bullets, or plain lines where they all are already. */
  function bullets(): void {
    const box = bodyBox.current;
    if (box === null) {
      return;
    }

    const lineStart = body.lastIndexOf('\n', box.selectionStart - 1) + 1;
    const lines = body.slice(lineStart, box.selectionEnd).split('\n');
    const allBullets = lines.every((line) => BULLET.test(line));
    const changed = lines
      .map((line) => (allBullets ? line.replace(BULLET, '') : `- ${line}`))
      .join('\n');

    rewrite(
      body.slice(0, lineStart) + changed + body.slice(box.selectionEnd),
      lineStart,
      lineStart + changed.length,
    );
  }

  return (
    <Modal
      wide
      title={email.label}
      tags={<span className="tag">To {email.readBy}</span>}
      onClose={onClose}
      actions={
        <>
          {email.isReworded ? (
            <button
              type="button"
              className="linkish"
              disabled={busy}
              onClick={() => {
                run(putBackEmailWording(email.name), (back) => {
                  onSaved(back, `“${email.label}” is back to its original wording.`);
                });
              }}
            >
              <Icon name="again" />
              Put back the original wording
            </button>
          ) : null}

          <span className="modal-actions-end">
            {preview === undefined ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  run(previewEmail(email.name, { subject, body }), setPreview);
                }}
              >
                Preview
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPreview(undefined);
                }}
              >
                Back to editing
              </button>
            )}
            <button type="submit" form={formId} className="primary" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </span>
        </>
      }
    >
      <form
        id={formId}
        className="wording-editor"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          run(rewordEmail(email.name, { subject, body }), (next) => {
            onSaved(next, `Saved. The next “${email.label}” email goes out in these words.`);
          });
        }}
      >
        {refusal === undefined ? null : <Notice problem={refusal} />}

        {/* Previewing swaps the editor out; the words stay in state, so nothing is lost. */}
        {preview === undefined ? (
          <>
            <div className="wording-fields">
              <label>
                Subject line
                <input
                  ref={subjectBox}
                  value={subject}
                  maxLength={longestSubject}
                  disabled={busy}
                  aria-invalid={refusal?.field === 'subject'}
                  onFocus={() => {
                    lastFocused.current = 'subject';
                  }}
                  onChange={(event) => {
                    setSubject(event.target.value);
                  }}
                />
              </label>

              <div className="message-field">
                <span id={`${formId}-message`}>Message</span>
                <div className="editor-box">
                  <div className="format-bar" role="toolbar" aria-label="Formatting">
                    {FORMATS.map((format) => (
                      <button
                        key={format.label}
                        type="button"
                        aria-label={format.label}
                        title={format.title}
                        disabled={busy}
                        onClick={() => {
                          wrap(format.marker);
                        }}
                      >
                        {format.mark}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="Bulleted list"
                      title="Bulleted list"
                      disabled={busy}
                      onClick={bullets}
                    >
                      <Icon name="list" />
                    </button>
                  </div>
                  <textarea
                    ref={bodyBox}
                    value={body}
                    rows={14}
                    maxLength={longestBody}
                    disabled={busy}
                    aria-labelledby={`${formId}-message`}
                    aria-invalid={refusal?.field === 'body'}
                    onFocus={() => {
                      lastFocused.current = 'body';
                    }}
                    onKeyDown={(event) => {
                      const format = FORMATS.find((one) => one.key === event.key.toLowerCase());

                      if ((event.ctrlKey || event.metaKey) && format !== undefined) {
                        event.preventDefault();
                        wrap(format.marker);
                      }
                    }}
                    onChange={(event) => {
                      setBody(event.target.value);
                    }}
                  />
                </div>
                <small className="muted">
                  A blank line starts a new paragraph. Preview to see the formatting.
                </small>
              </div>
            </div>

            <aside className="wording-placeholders">
              <h3>Placeholders</h3>
              <p className="muted">Click one to add it where you were typing.</p>

              <div className="placeholder-groups">
                <Placeholders
                  title="In this email"
                  placeholders={inUse}
                  busy={busy}
                  onPick={insert}
                />
                <Placeholders
                  title="More you can add"
                  placeholders={notInUse}
                  busy={busy}
                  onPick={insert}
                />
              </div>

              <p className="placeholder-tip">
                Tip: a capital first letter, as in <code>{'{{DecidedBy}}'}</code>, capitalises what
                it fills in.
              </p>
            </aside>
          </>
        ) : (
          <div className="wording-preview" aria-live="polite">
            <p className="muted">As it would read on a made up request. Nothing is saved yet.</p>
            <EmailFrame preview={preview} />
          </div>
        )}
      </form>
    </Modal>
  );
}

/** The saved wording, filled in on a made up request. */
function PreviewDialog({
  email,
  onEdit,
  onClose,
  onSignedOut,
}: {
  email: EmailWording;
  onEdit: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [preview, setPreview] = useState<EmailPreview | undefined>(undefined);
  const [refusal, setRefusal] = useState<Problem | undefined>(undefined);

  useEffect(() => {
    let current = true;

    previewEmail(email.name, { subject: email.subject, body: email.body })
      .then((found) => {
        if (current) {
          setPreview(found);
        }
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        if (current) {
          setRefusal(problemFrom(error));
        }
      });

    return () => {
      current = false;
    };
  }, [email, onSignedOut]);

  return (
    <Modal
      title={email.label}
      tags={<span className="tag">To {email.readBy}</span>}
      onClose={onClose}
      actions={
        <span className="modal-actions-end">
          <button type="button" className="primary" onClick={onEdit}>
            <Icon name="pencil" />
            Change the wording
          </button>
        </span>
      }
    >
      <p className="muted">As it would read on a made up request.</p>
      {refusal === undefined ? null : <Notice problem={refusal} />}
      {preview === undefined ? (
        refusal === undefined ? (
          <div className="skeleton" />
        ) : null
      ) : (
        <EmailFrame preview={preview} />
      )}
    </Modal>
  );
}

/**
 * A filled in email, set out as an inbox shows one.
 *
 * The server's HTML, in a frame that runs no script, sized to its content once it loads.
 */
function EmailFrame({ preview }: { preview: EmailPreview }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(160);

  return (
    <article className="email-frame">
      <header>
        <span className="chip">
          <Icon name="mail" />
        </span>
        <strong>{preview.subject}</strong>
      </header>
      <iframe
        ref={frame}
        title="The message"
        sandbox="allow-same-origin"
        srcDoc={`<!doctype html><html><body style="margin:16px;background:#ffffff">${preview.html}</body></html>`}
        style={{ height }}
        onLoad={() => {
          const page = frame.current?.contentDocument?.documentElement;

          if (page !== undefined) {
            setHeight(page.scrollHeight);
          }
        }}
      />
    </article>
  );
}

const FORMATS = [
  { label: 'Bold', title: 'Bold (Ctrl+B)', marker: '**', key: 'b', mark: <b>B</b> },
  { label: 'Italic', title: 'Italic (Ctrl+I)', marker: '_', key: 'i', mark: <i>I</i> },
  { label: 'Underline', title: 'Underline (Ctrl+U)', marker: '__', key: 'u', mark: <u>U</u> },
];

/** A line that starts a bullet, as the server reads one. */
const BULLET = /^\s*[-•]\s+/;

/** One group of placeholders, each a card that inserts it. Nothing when the group is empty. */
function Placeholders({
  title,
  placeholders,
  busy,
  onPick,
}: {
  title: string;
  placeholders: EmailWording['placeholders'];
  busy: boolean;
  onPick: (name: string) => void;
}) {
  if (placeholders.length === 0) {
    return null;
  }

  return (
    <>
      <h4>{title}</h4>
      <ul className="placeholders">
        {placeholders.map((one) => (
          <li key={one.name}>
            <button
              type="button"
              className="placeholder"
              title={sentenceCase(one.meaning)}
              disabled={busy}
              onClick={() => {
                onPick(one.name);
              }}
            >
              <span className="placeholder-token">{`{{${one.name}}}`}</span>
              <span className="placeholder-meaning">{sentenceCase(one.meaning)}</span>
              <span className="placeholder-add">
                <Icon name="plus" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The placeholder names a text uses, with `{{DecidedBy}}` counted as `decidedBy`. */
function placeholdersIn(text: string): Set<string> {
  return new Set(
    (text.match(/\{\{\w+\}\}/g) ?? []).map(
      (token) => token.charAt(2).toLowerCase() + token.slice(3, -2),
    ),
  );
}
