export async function nestedIfElse(input: number): Promise<string> {
  if (input > 0) {
    if (input > 100) {
      return 'large positive';
    } else {
      return 'small positive';
    }
  } else {
    return 'non-positive';
  }
}
