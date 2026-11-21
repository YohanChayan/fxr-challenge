// signup_form_start's guard: decides which interaction is the first one the USER caused.
// No DOM access: the component passes a focus function and the events it receives.
//
// - Our own focus() calls (on open, after an error, on Retry) dispatch focusin synchronously, so
//   a flag set around them marks those focusins as ours.
// - A focusin with no relatedTarget on the element we last focused is the browser restoring
//   focus after a tab or window switch: also not the user.
// - Typing, any other focus, and a submit (Enter on the auto-focused input fires neither focusin
//   nor input) all count. onStart runs once per guard, i.e. once per page view.

/** The parts of a focusin / input event the guard reads. */
export type InteractionEvent = { type: string; target: unknown; relatedTarget?: unknown };

export function useFormStart(onStart: () => void) {
  let started = false;
  let focusingFromCode = false;
  let focusedFromCode: unknown = null;

  /** Runs `focus`, which returns the element that now has focus (document.activeElement). */
  function focusFromCode(focus: () => unknown): void {
    focusingFromCode = true;
    try {
      focusedFromCode = focus();
    } finally {
      focusingFromCode = false;
    }
  }

  /** A focusin, input or submit inside the form. Pass no event for a submit. */
  function interact(event?: InteractionEvent): void {
    if (started || focusingFromCode) return;
    const restoredFocus =
      event?.type === 'focusin' &&
      (event.relatedTarget ?? null) === null &&
      event.target === focusedFromCode;
    if (restoredFocus) return;
    started = true;
    onStart();
  }

  return { focusFromCode, interact };
}
