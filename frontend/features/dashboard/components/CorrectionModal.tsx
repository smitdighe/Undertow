"use client";

// Correction dialog for ONCALL users. Field-specific value controls; original
// value shown so the operator sees what they're overriding. The server is the
// real authority — useCorrection maps its 403/400/404 into readable errors.
import { useEffect, useState } from "react";
import { Badge, Button, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  SEVERITY_VALUES,
  type CorrectionField,
  type Incident,
  type Severity,
} from "@/types/incident";
import { useCorrection } from "../hooks/useCorrection";

const FIELDS: { value: CorrectionField; label: string }[] = [
  { value: "severity", label: "Severity" },
  { value: "team", label: "Team" },
  { value: "duplicate", label: "Duplicate of" },
];

export function CorrectionModal({
  incident,
  onClose,
}: {
  /** null = closed. */
  incident: Incident | null;
  onClose: () => void;
}) {
  const { submit, submitting, error, reset } = useCorrection(incident?.id ?? null);

  const [field, setField] = useState<CorrectionField>("severity");
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [team, setTeam] = useState("");
  const [duplicateOf, setDuplicateOf] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Fresh form per incident — a half-typed correction for one incident must
  // never leak into the next.
  useEffect(() => {
    if (!incident) return;
    setField("severity");
    setSeverity(null);
    setTeam("");
    setDuplicateOf("");
    setLocalError(null);
    reset();
  }, [incident, reset]);

  if (!incident) return null;

  // Ties whichever value control is visible to the error text below it, so a
  // screen reader hears the rejection while focus is still in the field.
  const errorText = localError ?? error;
  const errorId = errorText ? "correction-error" : undefined;

  const originalValue =
    field === "severity"
      ? incident.severity
      : field === "team"
        ? (incident.suggestedTeam ?? "—")
        : (incident.duplicateOfId ?? "—");

  const correctedValue =
    field === "severity" ? severity ?? "" : field === "team" ? team.trim() : duplicateOf.trim();

  const onSubmit = async () => {
    setLocalError(null);
    if (!correctedValue) {
      setLocalError(
        field === "severity" ? "Pick a severity." : "Enter a value."
      );
      return;
    }
    if (field === "duplicate" && correctedValue === incident.id) {
      // The server rejects this too; catching it here saves the round-trip.
      setLocalError("An incident can't duplicate itself.");
      return;
    }
    const result = await submit({ field, correctedValue });
    if (result) onClose();
  };

  return (
    <Modal open onClose={onClose} aria-labelledby="correction-title">
      <div className="flex flex-col gap-5 p-6">
        <div>
          <h2 id="correction-title" className="font-display text-heading text-text">
            Correct incident
          </h2>
          <p className="mt-1 line-clamp-1 text-label text-muted">{incident.title}</p>
        </div>

        <div
          role="radiogroup"
          aria-label="Field to correct"
          className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-void/40 p-1"
        >
          {FIELDS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={field === f.value}
              onClick={() => setField(f.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-label transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime",
                field === f.value ? "bg-card text-text" : "text-muted hover:text-text"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <p className="font-mono text-mono-sm text-muted">
          Current: <span className="text-text">{originalValue}</span>
        </p>

        {field === "severity" && (
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="New severity"
            aria-describedby={errorId}
          >
            {SEVERITY_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={severity === value}
                onClick={() => setSeverity(value)}
                className={cn(
                  "rounded-full border px-3 py-1 font-mono text-mono-sm uppercase transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime",
                  severity === value
                    ? "border-lime/60 text-lime"
                    : "border-border text-muted hover:text-text"
                )}
              >
                {value}
              </button>
            ))}
          </div>
        )}

        {field === "team" && (
          <Input
            aria-label="New team"
            aria-describedby={errorId}
            placeholder="e.g. platform"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            disabled={submitting}
          />
        )}

        {field === "duplicate" && (
          <Input
            aria-label="Duplicate target incident id"
            aria-describedby={errorId}
            placeholder="Incident id this duplicates"
            value={duplicateOf}
            onChange={(e) => setDuplicateOf(e.target.value)}
            disabled={submitting}
          />
        )}

        {field === "duplicate" && (
          <Badge className="self-start border-alert/40 text-alert/80">
            Marks this incident DUPLICATE
          </Badge>
        )}

        {errorText && (
          <p id="correction-error" role="alert" className="text-label text-alert">
            {errorText}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting} aria-busy={submitting}>
            Apply correction
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default CorrectionModal;
