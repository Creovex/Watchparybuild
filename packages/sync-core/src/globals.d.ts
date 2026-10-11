// The WHATWG URL class exists in every runtime this package runs in (browsers, Node, Deno), but the
// package compiles without the DOM library so that no browser API slips into the sync core.
declare class URL {
  constructor(url: string, base?: string);
  hash: string;
  hostname: string;
  pathname: string;
  protocol: string;
  readonly searchParams: { get(name: string): string | null };
  toString(): string;
}
