/** Reads the target tab ID the service worker put into the management tab URL. */
export function targetTabIdFrom(search: string): number | null {
  const raw = new URLSearchParams(search).get("target");
  if (raw === null || !/^[0-9]{1,15}$/.test(raw)) {
    return null;
  }
  return Number(raw);
}
