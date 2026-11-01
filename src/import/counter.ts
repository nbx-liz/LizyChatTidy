// Counters keyed by values read from the export. Keys such as "constructor"
// or "__proto__" must count like any other key, so counters have no
// prototype and are read through Object.hasOwn.

export type Counter = Record<string, number>;

export function newCounter(): Counter {
  return Object.create(null) as Counter;
}

export function increment(counter: Counter, key: string): void {
  counter[key] = (Object.hasOwn(counter, key) ? (counter[key] ?? 0) : 0) + 1;
}
