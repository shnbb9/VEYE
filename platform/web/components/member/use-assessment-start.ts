import { useEffect } from "react";
import { recordAssessmentStart, type InstrumentKey } from "@/lib/member-api";

/** Say once that a form was begun: the first answer, not the visit. Saving it
 *  (which empties or leaves the form) and starting over says it again; the API
 *  decides whether that is the same attempt. */
export function useAssessmentStart(instrument: InstrumentKey, begun: boolean) {
  useEffect(() => { if (begun) void recordAssessmentStart(instrument); }, [instrument, begun]);
}
