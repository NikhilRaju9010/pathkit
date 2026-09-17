export async function bracelessIfElse(isHeads: boolean): Promise<string> {
  if (isHeads) return 'heads';
  else return 'tails';
}
