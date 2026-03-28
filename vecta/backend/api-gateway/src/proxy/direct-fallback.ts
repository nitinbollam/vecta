/** Single-process gateway: no separate identity service URL → mount routers in-process. */
export function isDirectMode(): boolean {
  return !process.env.IDENTITY_SERVICE_URL;
}
