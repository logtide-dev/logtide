/**
 * Thrown (as a rejection) by StorageEngine methods an engine has not
 * implemented yet. `method` names the contract method.
 */
export class NotImplementedError extends Error {
  readonly method: string;

  constructor(method: string, implementer: string) {
    super(`${method} is not implemented by ${implementer}`);
    this.name = 'NotImplementedError';
    this.method = method;
  }
}
