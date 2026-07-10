export const READING_LIST_CHANGED_EVENT = "cpc:reading-list-changed";

export function emitReadingListChanged() {
  window.dispatchEvent(new Event(READING_LIST_CHANGED_EVENT));
}
