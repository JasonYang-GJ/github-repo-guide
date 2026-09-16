import { work } from "./worker.js";
import defaultWork from "./default-worker.js";
import * as namespaceWorker from "./namespace-worker.js";
import { barrelWork } from "./barrel.js";

function prepare(value: string): string {
  return value.trim();
}

export function run(value: string): string {
  const prepared = work(prepare(value));
  const defaulted = defaultWork(prepared);
  const namespaced = namespaceWorker.namespaceWork(defaulted);
  return barrelWork(namespaced);
}
