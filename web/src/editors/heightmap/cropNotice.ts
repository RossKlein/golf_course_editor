const KEY = "courseMaker.cropNotice";

/** A crop or its undo changes the whole map, so the page is loaded afresh. This keeps what to say about it across the reload. */
export function reloadWith(message: string) {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // no storage (a private window): the reload just says nothing
  }
  location.reload();
}

/** What was left to say by the last reload, once. */
export function takeNotice(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}
