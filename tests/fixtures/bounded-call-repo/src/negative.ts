import { work } from "./worker.js";
import { namespaceWork as neverCalled } from "./namespace-worker.js";

type Callback = () => void;

export function unsafeCandidates(
  work: Callback,
  object: Record<string, Callback>,
  name: string,
): void {
  // work() in a comment is not a call.
  const pseudocode = "neverCalled()";
  void pseudocode;
  work();
  object[name]();
}

export function localShadow(callback: Callback): void {
  const work = callback;
  work();
}

function third(): void {}

function second(): void {
  third();
}

export function first(): void {
  second();
}

export function branchCaller(flag: boolean): void {
  if (flag) work();
}

export function orderedCaller(): void {
  second();
  work();
}
