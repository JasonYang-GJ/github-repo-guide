import { loadNotes } from "./repository.js";

export function listNotes(): readonly string[] {
  return loadNotes();
}
