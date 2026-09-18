export async function orderWorkflow(isHeads: boolean): Promise<string> {
  if (isHeads) {
    return 'heads';
  } else {
    return 'tails';
  }
}
