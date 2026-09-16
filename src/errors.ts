export class PathKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathKitError';
  }
}
