/** Error with an HTTP status for the local API; its message is shown to the user (Persian). */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
