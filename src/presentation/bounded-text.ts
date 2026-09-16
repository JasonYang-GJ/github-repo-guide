/** Bound display text to a schema's Unicode-character limit, visibly marking omission.
 * Never use this on source evidence: its exact bytes/ranges must remain intact.
 */
export function boundedText(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join("")}…`;
}
