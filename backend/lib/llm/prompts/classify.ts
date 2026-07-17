import { SEVERITY_VALUES } from "@/lib/llm/types";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM_PROMPT = `You are an incident triage assistant for an on-call engineering team.
Classify the incident and draft a short first response.

Return ONLY a single JSON object, no prose, no markdown fences, matching exactly this shape:
{
  "severity": one of ${JSON.stringify(SEVERITY_VALUES)},
  "suggestedTeam": string (the engineering team best suited to own this, e.g. "Platform", "Payments", "Frontend"),
  "draftResponse": string (2-4 sentence acknowledgement + next step, addressed to the reporter)
}

Rules:
- severity MUST be exactly one of the allowed uppercase values.
- Do not include any keys other than severity, suggestedTeam, draftResponse.
- Do not wrap the JSON in backticks or add commentary.`;

/** Build the chat messages that instruct the model to emit schema-valid JSON. */
export function buildClassifyMessages(title: string, body: string): ChatMessage[] {
  const userContent = `Incident title: ${title}

Incident body:
${body}

Respond with the JSON object now.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
