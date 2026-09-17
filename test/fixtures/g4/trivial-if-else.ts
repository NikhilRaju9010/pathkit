export async function trivialIfElse(isHeads: boolean): Promise<string> {
  if (isHeads) {
    return 'heads';
  } else {
    return 'tails';
  }
}
