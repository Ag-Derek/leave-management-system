/** Edit and remove, drawn the same way everywhere: a blue pencil and a red bin. */

import { Icon } from './Icon';

interface ActionButtonProps {
  /** What it does, to what, for a screen reader: "Edit the 25 December holiday". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Extra classes for where it sits, such as `trailing` on the end of a sentence. */
  className?: string;
}

export function EditButton({ label, onClick, disabled = false, className }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={`iconic action-icon is-edit${className === undefined ? '' : ` ${className}`}`}
      title="Edit"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="pencil" />
      <span className="visually-hidden">{label}</span>
    </button>
  );
}

export function RemoveButton({ label, onClick, disabled = false, className }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={`iconic action-icon is-remove${className === undefined ? '' : ` ${className}`}`}
      title="Remove"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="bin" />
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
