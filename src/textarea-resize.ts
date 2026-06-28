// Description-textarea auto-resize extracted from YouTubeBatchManager (A11).
// Same rAF-throttled algorithm (A30); the pending-set is module-level state,
// which is equivalent to the former instance field since the app is a
// singleton.

// Textareas with a resize already scheduled for the next frame (A30). A
// WeakSet so entries are GC'd together with their (removed) textareas.
const pendingTextareaResizes = new WeakSet<HTMLTextAreaElement>();

// rAF-throttled auto-resize (A30): the resize forces a synchronous reflow
// (height write + scrollHeight read), so running it inline made every
// keystroke reflow the page. At most one resize per textarea per frame is
// scheduled; rapid input events coalesce into a single final resize.
export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  if (pendingTextareaResizes.has(textarea)) {
    return;
  }
  pendingTextareaResizes.add(textarea);
  requestAnimationFrame(() => {
    pendingTextareaResizes.delete(textarea);
    resizeTextareaNow(textarea);
  });
}

// Synchronous resize, used directly by callers that are already inside an
// animation frame (the post-insert batch in renderVideos), where deferring
// by another frame would flash the unsized textarea for one paint.
export function resizeTextareaNow(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  const minHeight = 140;
  const newHeight = Math.max(textarea.scrollHeight, minHeight);
  textarea.style.height = newHeight + 'px';
}
