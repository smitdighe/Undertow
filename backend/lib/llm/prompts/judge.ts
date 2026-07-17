/** The logical fields an eval can judge. Mirrors the correction API's fields. */
export type JudgeField = "severity" | "team" | "duplicate";

export interface JudgeInput {
  title: string;
  body: string;
  field: JudgeField;
  /** What the production classifier produced on this re-run. */
  classifierValue: string;
  /** The human-corrected value — treated as ground truth. */
  correctedValue: string;
}

const FIELD_GUIDANCE: Record<JudgeField, string> = {
  severity:
    "Severity levels are LOW < MEDIUM < HIGH < CRITICAL. Adjacent levels are often defensible for the same incident; judge whether the classifier's level is a reasonable reading of the impact described, not whether it matches the human exactly.",
  team: "Team names are free-form. Different names can refer to the same owning team (e.g. 'Platform' vs 'Infrastructure', 'Payments' vs 'Billing'). Judge whether the classifier's team would plausibly own this incident.",
  duplicate:
    "The value is the id of an incident this one duplicates (or 'none'). Judge whether treating the classifier's answer as the duplicate target is defensible given the incident text.",
};

/**
 * Build the judge prompt. The judge is an INDEPENDENT arbiter for borderline
 * disagreements — cases where strict string equality would unfairly score a
 * defensible answer as wrong.
 */
export function buildJudgePrompt(input: JudgeInput): string {
  return `You are an impartial evaluator auditing an incident-triage classifier.

You are given an incident, the classifier's answer for ONE field, and the value a human on-call engineer corrected it to. The human's value is the reference, but humans are not infallible and multiple answers can be defensible.

Field under review: ${input.field}
${FIELD_GUIDANCE[input.field]}

--- INCIDENT ---
Title: ${input.title}

Body:
${input.body}
--- END INCIDENT ---

Classifier answered: ${JSON.stringify(input.classifierValue)}
Human corrected to:  ${JSON.stringify(input.correctedValue)}

Question: was the classifier's answer REASONABLE for this incident?
- Answer true if the classifier's answer is defensible, even if the human chose differently.
- Answer false if the classifier's answer is clearly wrong or misleading given the incident.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "reasonable": boolean,
  "rationale": string (one sentence explaining the call)
}`;
}
