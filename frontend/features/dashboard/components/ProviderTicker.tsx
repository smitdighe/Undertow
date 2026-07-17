"use client";

// PENDING A BACKEND FIELD — renders nothing today, on purpose.
//
// The intent is a ticker of which LLM provider (groq/cerebras/gemini) classified
// recent incidents. That information exists server-side only inside the worker's
// LLM router; it is not persisted on Incident and is absent from both the
// GET /api/incidents select and the SSE `incident` event payload
// (backend/lib/sse/bus.ts fetchEvent). There is nothing truthful to render, and
// inventing a provider ("probably Groq") would be fabricating telemetry.
//
// When the backend adds provider metadata (e.g. Incident.classifiedBy, or an
// out-of-band field on IncidentEvent), type it in types/incident.ts and render
// it here. Until then: null, not a guess.
export function ProviderTicker() {
  return null;
}

export default ProviderTicker;
