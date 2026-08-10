export class PlatformError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'conflict'
      | 'forbidden'
      | 'invalid_input'
      | 'not_found'
      | 'registration_closed'
      | 'unauthorized',
  ) {
    super(message)
  }
}
