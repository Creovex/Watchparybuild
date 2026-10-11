// The stub adapter's test hook (apps/web/lib/adapters/stub.ts), present only in test builds.
export {};
declare global {
  interface Window {
    __stub?: { setBuffering(on: boolean): void; position(): number };
  }
}
