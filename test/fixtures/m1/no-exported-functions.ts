async function internalHelper(): Promise<string> {
  return 'not a workflow entry point';
}

const anotherHelper = async (): Promise<string> => {
  return 'also not a workflow entry point';
};

export const someConstant = 42;
