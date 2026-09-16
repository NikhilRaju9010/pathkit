export async function firstWorkflow(): Promise<string> {
  return 'first';
}

export async function secondWorkflow(flag: boolean): Promise<string> {
  if (flag) {
    return 'yes';
  }
  return 'no';
}
