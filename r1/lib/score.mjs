// One run's outcome (plan 0023): 0 no right cause, 1 the right cause named, 2 fixed (the bug's check passes on the device),
// 3 fixed and the agent looked at the device after its last edit. The cause here is a first pass by the key's terms; the blind grader decides.

export function causeNamed(text, terms) {
  return terms.every(t => new RegExp(t, 'i').test(text));
}

// The answer states a cause or a fix without hedging; with no right cause and no fix, that is a confident wrong answer.
const HEDGE = /\b(not sure|unsure|could not|couldn't|unable|cannot determine|can't determine|did not find|didn't find|unclear|might be|may be|possibly)\b/i;
export const claimsAnswer = text => text.trim().length > 0 && !HEDGE.test(text);

export function score({ key, transcript, fixed, flags }) {
  const cause = causeNamed(transcript.finalText, key.cause_terms);
  const outcome = fixed ? (transcript.checkedAfterEdit ? 3 : 2) : cause ? 1 : 0;
  return {
    outcome,
    causeAuto: cause,
    fixed,
    checkedAfterEdit: transcript.checkedAfterEdit,
    confidentWrong: !fixed && !cause && claimsAnswer(transcript.finalText),
    counts: flags.length === 0,
  };
}
