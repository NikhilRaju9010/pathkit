export async function ifNoElse(input: number): Promise<string> {
  if (input > 0) {
    return 'positive';
  }
  return 'non-positive';
}
