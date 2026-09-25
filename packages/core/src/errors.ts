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
  | 'GIT_FAILED'
  | 'REF_BROKEN'
  | 'REF_CYCLE'
  | 'REGION_MALFORMED'
  | 'ADAPTER_NOT_FOUND'
  | 'LOCK_CORRUPT'
  | 'PLAN_BLOCKED'
  | 'PLAN_STALE'
  | 'CONFLICTS_UNRESOLVED'
  | 'DEPLOY_NOT_FOUND'
  | 'ROLLBACK_REFUSED'
  | 'SETTINGS_NOT_LOADED'
  | 'SETTINGS_INVALID';

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
