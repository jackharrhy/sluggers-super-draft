export class PlatformError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'conflict'
      | 'external_service'
      | 'forbidden'
      | 'invalid_input'
      | 'not_found'
      | 'registration_closed'
      | 'unauthorized',
  ) {
    super(message)
  }
}
