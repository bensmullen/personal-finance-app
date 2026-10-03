/** A result owns its own row memo; replacing the result discards the memo. */
export class ExplanationCache<T> {
  readonly #rows = new Map<string, T | undefined>();
  get(rowId: string, resolve: () => T): T | undefined {
    if (!this.#rows.has(rowId)) {
      try { this.#rows.set(rowId, resolve()); } catch { this.#rows.set(rowId, undefined); }
    }
    return this.#rows.get(rowId);
  }
}

/** Mounted-app owner: survives navigation, invalidates when financial result identity changes. */
export class ResultExplanationCache<T> {
  #result: object | undefined;
  #cache = new ExplanationCache<T>();
  forResult(result: object): ExplanationCache<T> {
    if (result !== this.#result) {
      this.#result = result;
      this.#cache = new ExplanationCache<T>();
    }
    return this.#cache;
  }
}
