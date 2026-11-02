/**
 * How long things live. The code that enforces each limit and the privacy policy that
 * announces it both read from here, so the two cannot quietly disagree.
 */
export const SESSION_DAYS = 14;
export const PASSWORD_RESET_MINUTES = 30;
export const EMAIL_VERIFICATION_HOURS = 24;
/** Finished background jobs hold ids only; they are removed after this long. */
export const JOB_RETENTION_DAYS = 7;
/** Daily backups kept (BACKUP_KEEP overrides). A deleted record can survive in a backup this many days. */
export const DEFAULT_BACKUP_KEEP = 14;
/** How quickly customers are told of a personal data breach (Data Processing Addendum). */
export const BREACH_NOTICE_HOURS = 48;
/** How long customers can still export their data after an agreement ends (Terms and the Addendum). */
export const POST_TERMINATION_EXPORT_DAYS = 30;
/** Notice given before a new sub-processor is used (Addendum). */
export const SUBPROCESSOR_NOTICE_DAYS = 30;
