/** Error codes for expected failures. Core returns/throws AmcError for these; anything else is a bug. */
export type AmcErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_WRITE_FAILED'
  | 'PATH_OUTSIDE_ROOT'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_PARSE_FAILED'
  | 'ITEM_LAYOUT_INVALID'
  | 'NATIVE_PARSE_FAILED'
  | 'ITEM_NOT_FOUND'
  | 'SLUG_TAKEN'
  | 'ITEM_REFERENCED'
  | 'TEMPLATE_NOT_FOUND'
  | 'GIT_FAILED';

export class AmcError extends Error {
  constructor(
    readonly code: AmcErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AmcError';
  }
}

export const isAmcError = (e: unknown, code?: AmcErrorCode): e is AmcError =>
  e instanceof AmcError && (code === undefined || e.code === code);
