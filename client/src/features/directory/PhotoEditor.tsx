import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ACCEPTED_PHOTO_TYPES,
  isNotSignedIn,
  MAX_PHOTO_BYTES,
  MIN_PHOTO_SIDE,
  type MyProfile,
  type PhotoCrop,
  type PhotoLinks,
  removeMyPhoto,
  uploadMyPhoto,
} from '../../api';
import { Icon } from '../../Icon';
import { Modal } from '../../Modal';
import { Notice, type Problem, problemFrom } from '../../problem';

/** How wide the square the photo is positioned in is drawn, in CSS pixels. */
const FRAME = 288;

/** The most a photo may be zoomed, before the square it leaves is too small to keep. */
const MOST_ZOOM = 4;

/** How far an arrow key moves the photo, in CSS pixels. */
const NUDGE = 8;

/**
 * Putting up my photo, positioning it, and taking it down. On my own profile only.
 *
 * The file is checked here first so that a wrong type or a file too large is named before
 * anything is sent, in the same words the server would use. The server checks again and is
 * the one that is believed: it reads the bytes, cuts the square chosen here, and keeps nothing
 * the camera wrote.
 */
export function PhotoEditor({
  mine,
  onChanged,
  onSignedOut,
  children,
}: {
  mine: MyProfile;
  /** The avatar, which is what is pressed to change it. */
  children: ReactNode;
  /** The photo as it now stands, or null for initials. */
  onChanged: (photo: PhotoLinks | null) => void;
  onSignedOut: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<Chosen | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [done, setDone] = useState<string | undefined>(undefined);
  const hint = `JPEG, PNG or WebP, up to ${megabytes(MAX_PHOTO_BYTES)} MB.`;

  /* The copy of the file held for the preview is let go when it is no longer shown. */
  useEffect(
    () => () => {
      if (chosen !== undefined) {
        URL.revokeObjectURL(chosen.url);
      }
    },
    [chosen],
  );

  const choose = (file: File | undefined) => {
    setProblem(undefined);
    setDone(undefined);

    if (file === undefined) {
      return;
    }

    const refusal = fileProblem(file);

    if (refusal !== null) {
      setProblem({ what: refusal, field: 'file', worthRetrying: false });
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      if (Math.min(image.naturalWidth, image.naturalHeight) < MIN_PHOTO_SIDE) {
        URL.revokeObjectURL(url);
        setProblem({
          what:
            `That is ${String(image.naturalWidth)} by ${String(image.naturalHeight)} pixels, and ` +
            `a photo needs at least ${String(MIN_PHOTO_SIDE)} by ${String(MIN_PHOTO_SIDE)} to ` +
            'show clearly. Choose a larger copy.',
          field: 'file',
          worthRetrying: false,
        });
        return;
      }

      setChosen({ file, url, width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      setProblem({
        what:
          'That file could not be read as an image. It may be damaged; try saving it again, or ' +
          'choose another.',
        field: 'file',
        worthRetrying: false,
      });
    };

    image.src = url;
  };

  const remove = () => {
    setRemoving(true);
    setProblem(undefined);

    removeMyPhoto(mine.employeeId)
      .then(() => {
        setConfirmingRemove(false);
        setDone('Photo removed. Colleagues see your initials now.');
        onChanged(null);
      })
      .catch((error: unknown) => {
        if (isNotSignedIn(error)) {
          onSignedOut();
          return;
        }

        setConfirmingRemove(false);
        setProblem(problemFrom(error));
      })
      .finally(() => {
        setRemoving(false);
      });
  };

  return (
    <div className="photo-editor">
      <input
        ref={input}
        id="photo-file"
        className="visually-hidden"
        type="file"
        accept={ACCEPTED_PHOTO_TYPES.join(',')}
        aria-describedby="photo-hint"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          /* So choosing the same file again, after a refusal, is a change. */
          event.target.value = '';
        }}
      />

      {/* The face is the button, with a camera on its corner, as a phone's own profile does. */}
      <button
        type="button"
        className="photo-trigger"
        title={`${mine.photo === null ? 'Add a photo' : 'Change photo'}: ${hint}`}
        aria-describedby="photo-hint"
        onClick={() => {
          input.current?.click();
        }}
      >
        {children}
        <span className="photo-badge" aria-hidden="true">
          <Icon name="camera" />
        </span>
        <span className="visually-hidden">
          {mine.photo === null ? 'Add a photo' : 'Change your photo'}
        </span>
      </button>

      <span id="photo-hint" className="visually-hidden">
        {hint}
      </span>

      {mine.photo === null ? null : (
        <button
          type="button"
          className="linkish is-danger photo-remove"
          onClick={() => {
            setDone(undefined);
            setConfirmingRemove(true);
          }}
        >
          Remove photo
        </button>
      )}

      {done === undefined ? null : (
        <p className="notice done" role="status">
          {done}
        </p>
      )}

      {problem === undefined ? null : <Notice problem={problem} />}

      {chosen === undefined ? null : (
        <Positioner
          chosen={chosen}
          employeeId={mine.employeeId}
          onSaved={(photo) => {
            setChosen(undefined);
            setDone('Photo saved. Colleagues see it now.');
            onChanged(photo);
          }}
          onCancel={() => {
            setChosen(undefined);
          }}
          onSignedOut={onSignedOut}
        />
      )}

      {confirmingRemove ? (
        <Modal
          title="Remove your photo?"
          onClose={() => {
            setConfirmingRemove(false);
          }}
          actions={
            <>
              <button
                type="button"
                disabled={removing}
                onClick={() => {
                  setConfirmingRemove(false);
                }}
              >
                Keep it
              </button>
              <button type="button" className="danger" disabled={removing} onClick={remove}>
                {removing ? 'Removing…' : 'Remove photo'}
              </button>
            </>
          }
        >
          <p>Colleagues will see your initials instead. You can add a photo again at any time.</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** A file that passed the checks here, ready to be positioned. */
interface Chosen {
  file: File;
  /** An object URL for the preview, revoked when it is closed. */
  url: string;
  /** As the browser draws it: the right way up. */
  width: number;
  height: number;
}

/**
 * Positioning the photo in the square that will be kept: drag it, zoom it, or use the arrow
 * keys. The circle is what colleagues will see.
 */
function Positioner({
  chosen,
  employeeId,
  onSaved,
  onCancel,
  onSignedOut,
}: {
  chosen: Chosen;
  employeeId: string;
  onSaved: (photo: PhotoLinks) => void;
  onCancel: () => void;
  onSignedOut: () => void;
}) {
  const shorter = Math.min(chosen.width, chosen.height);
  /* The scale at which the photo just covers the frame, and the most it may be zoomed past it. */
  const cover = FRAME / shorter;
  const mostZoom = Math.max(1, Math.min(MOST_ZOOM, shorter / MIN_PHOTO_SIDE));

  const [zoom, setZoom] = useState(1);
  /* Where the photo's top left corner is, relative to the frame's. Centred to begin with. */
  const [offset, setOffset] = useState(() => ({
    x: (FRAME - chosen.width * cover) / 2,
    y: (FRAME - chosen.height * cover) / 2,
  }));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const dragging = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined);

  const scale = cover * zoom;
  const drawnWidth = chosen.width * scale;
  const drawnHeight = chosen.height * scale;

  /** Held so the photo always covers the frame: no empty corner can be saved. */
  const held = (x: number, y: number) => ({
    x: Math.min(0, Math.max(FRAME - drawnWidth, x)),
    y: Math.min(0, Math.max(FRAME - drawnHeight, y)),
  });

  const position = held(offset.x, offset.y);

  const rezoom = (next: number) => {
    /* About the middle of the frame, so what is in the circle stays in it. */
    const nextScale = cover * next;
    const middle = FRAME / 2;
    const x = middle - ((middle - position.x) / scale) * nextScale;
    const y = middle - ((middle - position.y) / scale) * nextScale;

    setZoom(next);
    setOffset({
      x: Math.min(0, Math.max(FRAME - chosen.width * nextScale, x)),
      y: Math.min(0, Math.max(FRAME - chosen.height * nextScale, y)),
    });
  };

  const crop = cropOf(position, scale, chosen);

  const save = () => {
    setSaving(true);
    setProblem(undefined);

    uploadMyPhoto(employeeId, chosen.file, crop)
      .then(onSaved)
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

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = {
      pointerId: event.pointerId,
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;

    if (drag?.pointerId === event.pointerId) {
      setOffset(held(event.clientX - drag.x, event.clientY - drag.y));
    }
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointerId === event.pointerId) {
      dragging.current = undefined;
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [NUDGE, 0],
      ArrowRight: [-NUDGE, 0],
      ArrowUp: [0, NUDGE],
      ArrowDown: [0, -NUDGE],
    };
    const move = moves[event.key] as [number, number] | undefined;

    if (move !== undefined) {
      event.preventDefault();
      setOffset(held(position.x + move[0], position.y + move[1]));
    }
  };

  return (
    <Modal
      title="Position your photo"
      onClose={() => {
        if (!saving) {
          onCancel();
        }
      }}
      actions={
        <>
          <button type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </>
      }
    >
      <p className="muted">
        Drag the photo, or use the arrow keys, to put your face in the circle. The circle is what
        colleagues see.
      </p>

      <div className="photo-positioner">
        <div
          className="photo-frame"
          style={{ width: FRAME, height: FRAME }}
          role="application"
          aria-label="Photo position. Use the arrow keys to move it."
          tabIndex={0}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onKeyDown={keyDown}
        >
          <img
            src={chosen.url}
            alt=""
            draggable={false}
            style={{
              width: drawnWidth,
              height: drawnHeight,
              transform: `translate(${String(position.x)}px, ${String(position.y)}px)`,
            }}
          />
          <span className="photo-frame-circle" aria-hidden="true" />
        </div>

        <label className="photo-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={mostZoom}
            step={0.01}
            value={zoom}
            disabled={mostZoom === 1}
            onChange={(event) => {
              rezoom(Number(event.target.value));
            }}
          />
        </label>
      </div>

      {problem === undefined ? null : <Notice problem={problem} />}
    </Modal>
  );
}

/**
 * The square the frame shows, in pixels of the photo. Rounded down and held inside it, so
 * what is sent is whole numbers the server can cut exactly.
 */
function cropOf(position: { x: number; y: number }, scale: number, chosen: Chosen): PhotoCrop {
  const side = Math.min(
    Math.min(chosen.width, chosen.height),
    Math.max(MIN_PHOTO_SIDE, Math.round(FRAME / scale)),
  );

  return {
    left: Math.max(0, Math.min(chosen.width - side, Math.round(-position.x / scale))),
    top: Math.max(0, Math.min(chosen.height - side, Math.round(-position.y / scale))),
    side,
  };
}

/** A file refused before it is sent, in the words the server would use, or null. */
function fileProblem(file: File): string | null {
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return (
      `${file.name} is not a JPEG, PNG or WebP image, so it cannot be your photo. An iPhone ` +
      'photo saved as HEIC can be exported as JPEG first.'
    );
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return (
      `That photo is ${megabytes(file.size)} MB and the limit is ` +
      `${megabytes(MAX_PHOTO_BYTES)} MB. A smaller copy of it will do.`
    );
  }

  return null;
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
}
