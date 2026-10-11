/** Read access to environment variables. `Deno.env` fits it; tests pass a map. */
export interface Env {
  get(name: string): string | undefined;
}

/** A variable's value, or null when it is unset or blank. */
export function readEnv(env: Env, name: string): string | null {
  const value = env.get(name)?.trim();
  return value ? value : null;
}

/** True when a flag such as `TURN_TEST_MODE` is set to anything but empty, `0` or `false`. */
export function flagSet(env: Env, name: string): boolean {
  const value = readEnv(env, name);
  return value !== null && value !== '0' && value.toLowerCase() !== 'false';
}

export function envFromRecord(values: Record<string, string>): Env {
  return { get: (name) => values[name] };
}
