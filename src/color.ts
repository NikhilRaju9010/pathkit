const GREEN = '[32m';
const RED = '[31m';
const RESET = '[0m';

/**
 * Whether `report`'s text output should be colorized. True only when the
 * output stream is a real terminal (`isTTY`) AND nothing explicitly turns
 * color off: the `--no-color` flag (checked by the caller and passed in as
 * `noColorFlag`) or the `NO_COLOR` env var. Per https://no-color.org, *any*
 * non-empty value of `NO_COLOR` disables color, regardless of its content —
 * an empty string does not count as "set".
 */
export function shouldColorize(isTTY: boolean | undefined, noColorFlag: boolean): boolean {
  if (noColorFlag) return false;
  const noColorEnv = process.env.NO_COLOR;
  if (noColorEnv !== undefined && noColorEnv !== '') return false;
  return isTTY === true;
}

/**
 * Wraps `text` in green (`'covered'`) or red (`'missed'`) ANSI codes when
 * `enabled`; returns `text` completely unmodified when not. `text` is
 * always already the plain human word — color is pure decoration layered
 * on top, never a different string, so piped/non-TTY output (enabled=false)
 * reads correctly as plain text with no escape bytes at all.
 */
export function colorize(text: string, kind: 'covered' | 'missed', enabled: boolean): string {
  if (!enabled) return text;
  const code = kind === 'covered' ? GREEN : RED;
  return `${code}${text}${RESET}`;
}
