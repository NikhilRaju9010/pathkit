// Deliberately deferred: PathKit v1 does not detect `switch` as a branch
// point (see LIMITATIONS.md). This fixture proves the deferral is a
// tested, intentional behavior rather than an accidental gap.
export async function usesSwitch(input: number): Promise<string> {
  switch (input) {
    case 1:
      return 'one';
    case 2:
      return 'two';
    default:
      return 'other';
  }
}
