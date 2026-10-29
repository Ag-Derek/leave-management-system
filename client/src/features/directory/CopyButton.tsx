import { useEffect, useState } from 'react';
import { Icon } from '../../Icon';

/** How long "Copied" stays beside the icon. */
const SAID_FOR_MS = 2000;

/**
 * A small icon that puts some text on the clipboard, and says so for a moment.
 *
 * For writing from your own mail app instead of the portal's form: copy the address, paste it.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) {
      return;
    }

    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, SAID_FOR_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [copied, failed]);

  const copy = () => {
    /* The clipboard is only there on a secure page, which localhost and the live site both are. */
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
      })
      .catch(() => {
        setFailed(true);
      });
  };

  return (
    <>
      <button type="button" className="iconic action-icon is-edit" title="Copy" onClick={copy}>
        <Icon name="copy" />
        <span className="visually-hidden">{label}</span>
      </button>
      <span className="icon-said" role="status">
        {copied ? 'Copied' : failed ? 'Could not copy' : ''}
      </span>
    </>
  );
}
