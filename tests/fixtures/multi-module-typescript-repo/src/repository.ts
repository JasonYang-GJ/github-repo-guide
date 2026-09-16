const notes = ["first", "second"] as const;

export function loadNotes(): readonly string[] {
  return notes;
}
