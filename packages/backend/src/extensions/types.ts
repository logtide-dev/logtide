/** Version of the extension API contract. Bump on breaking changes. */
export const EXTENSION_API_VERSION = 1;

/** Process an extension is being registered in. */
export type ExtensionProcess = 'server' | 'worker';

/**
 * Surface handed to an extension's register(). Members are added by the
 * runtime tasks that implement them.
 */
export interface ExtensionApi {
  /** Extension name (also its Postgres schema name and route prefix). */
  readonly name: string;
}

export interface LogtideExtension {
  /** Must match ^[a-z][a-z0-9_]{1,30}$ */
  name: string;
  apiVersion: number;
  register(api: ExtensionApi): void | Promise<void>;
}
