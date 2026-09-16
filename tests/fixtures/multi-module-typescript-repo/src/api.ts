import { listNotes } from "./service.js";

export function createApi() {
  return { list: listNotes };
}

export { listNotes } from "./service.js";
