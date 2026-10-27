import { useEffect, useId, useRef, useState } from 'react';
import type { Me } from '../../api';
import { Icon } from '../../Icon';

/**
 * Who is signed in, and what they can do about it: open their own profile, or sign out.
 *
 * A button that shows and hides a short list, rather than an ARIA menu: two items need no
 * arrow-key roving, and a list of a link and a button is what a screen reader expects to
 * find after a button that says it expands. It closes on a pick, on Escape, and on a press
 * anywhere else.
 */
export function AccountMenu({
  me,
  initials,
  profileHref,
  onProfile,
  onSignOut,
}: {
  me: Me;
  initials: string;
  profileHref: string;
  /** Whether the profile is the page being shown, so its item can say so. */
  onProfile: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const pressedElsewhere = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const escaped = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };

    document.addEventListener('pointerdown', pressedElsewhere);
    document.addEventListener('keydown', escaped);

    return () => {
      document.removeEventListener('pointerdown', pressedElsewhere);
      document.removeEventListener('keydown', escaped);
    };
  }, [open]);

  const name = `${me.firstName} ${me.lastName}`;

  return (
    <div className="account" ref={box}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${name}, account`}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="whoami-name" aria-hidden="true">
          {name}
        </span>
        <Icon name="down" />
      </button>

      {open ? (
        <ul id={listId} className="account-menu">
          <li>
            <a
              href={profileHref}
              aria-current={onProfile ? 'page' : undefined}
              onClick={() => {
                setOpen(false);
              }}
            >
              My profile
            </a>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
