export function validateInput(input) {
  if (!input) {
    throw new Error("input is required");
  }
  return true;
}
