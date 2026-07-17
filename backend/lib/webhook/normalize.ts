/** The minimal slice of a GitHub issues webhook payload we care about. */
export interface GitHubIssueWebhookPayload {
  action?: string;
  issue?: {
    id?: number;
    node_id?: string;
    title?: string;
    body?: string | null;
  };
}

/** Incident-shaped data extracted from a webhook, ready for DB insert. */
export interface NormalizedIncident {
  source: "github";
  externalId: string;
  title: string;
  body: string;
}

/**
 * Map a GitHub issue webhook payload into the Incident shape.
 * Returns null for payloads that are not issue events (e.g. ping) or that
 * lack the fields needed to build an incident.
 */
export function normalizeGitHubIssue(
  payload: GitHubIssueWebhookPayload
): NormalizedIncident | null {
  const issue = payload.issue;
  if (!issue || !issue.title) return null;

  const externalId = issue.node_id ?? (issue.id != null ? String(issue.id) : null);
  if (!externalId) return null;

  return {
    source: "github",
    externalId,
    title: issue.title,
    body: issue.body ?? "", // GitHub issue bodies can be null
  };
}
