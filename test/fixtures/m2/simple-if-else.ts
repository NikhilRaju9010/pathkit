export async function simpleIfElse(isHeads: boolean): Promise<string> {
  if (isHeads) {
    return 'heads';
  } else {
    return 'tails';
  }
}
