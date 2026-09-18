import { colorize, shouldColorize } from '../src/color';

describe('shouldColorize', () => {
  const originalNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it('is true only when isTTY is true and nothing disables it', () => {
    delete process.env.NO_COLOR;
    expect(shouldColorize(true, false)).toBe(true);
  });

  it('is false when isTTY is false', () => {
    delete process.env.NO_COLOR;
    expect(shouldColorize(false, false)).toBe(false);
  });

  it('is false when isTTY is undefined (e.g. a piped subprocess)', () => {
    delete process.env.NO_COLOR;
    expect(shouldColorize(undefined, false)).toBe(false);
  });

  it('is false when the --no-color flag is set, even on a real TTY', () => {
    delete process.env.NO_COLOR;
    expect(shouldColorize(true, true)).toBe(false);
  });

  it('is false when NO_COLOR is set to any non-empty value, even on a real TTY', () => {
    process.env.NO_COLOR = '1';
    expect(shouldColorize(true, false)).toBe(false);
  });

  it('does not disable color when NO_COLOR is set but empty', () => {
    process.env.NO_COLOR = '';
    expect(shouldColorize(true, false)).toBe(true);
  });
});

describe('colorize', () => {
  it('wraps text in green ANSI codes for "covered" when enabled', () => {
    const result = colorize('covered', 'covered', true);
    expect(result).toBe('[32mcovered[0m');
  });

  it('wraps text in red ANSI codes for "missed" when enabled', () => {
    const result = colorize('missed', 'missed', true);
    expect(result).toBe('[31mmissed[0m');
  });

  it('returns the exact original text, unmodified, when disabled', () => {
    expect(colorize('covered', 'covered', false)).toBe('covered');
    expect(colorize('missed', 'missed', false)).toBe('missed');
  });
});
