export interface CompletionNotificationInspection {
  readonly workspaceValue?: boolean;
}

export type CompletionNotificationUpdateTarget = 'global' | 'workspace';

export function completionNotificationUpdateTarget(
  inspection: CompletionNotificationInspection | undefined,
): CompletionNotificationUpdateTarget {
  return inspection?.workspaceValue === undefined
    ? 'global'
    : 'workspace';
}
