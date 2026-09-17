import type { PersonalModelPersistencePort } from "../../src/application/personalPersistence.js";

const DATABASE_NAME = "personal-finance-app";
const DATABASE_VERSION = 1;
const STORE_NAME = "personal-model";
const PRIMARY_KEY = "primary";

export interface BrowserOriginLike {
  readonly protocol: string;
  readonly hostname: string;
}

export const isPersonalPersistenceEnabledOrigin = ({
  protocol,
  hostname,
}: BrowserOriginLike): boolean => {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  return protocol === "https:" && !host.endsWith(".github.io");
};

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser persistence request failed"));
  });

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error("Browser persistence transaction failed"));
    transaction.onabort = () => reject(new Error("Browser persistence transaction was aborted"));
  });

export class IndexedDbPersonalModelStore implements PersonalModelPersistencePort {
  readonly #factory: IDBFactory;
  #database: Promise<IDBDatabase> | undefined;

  constructor(factory: IDBFactory) {
    this.#factory = factory;
  }

  #open(): Promise<IDBDatabase> {
    if (this.#database !== undefined) return this.#database;
    this.#database = new Promise((resolve, reject) => {
      const request = this.#factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.#database = undefined;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.#database = undefined;
        reject(new Error("Browser persistence database could not be opened"));
      };
      request.onblocked = () => {
        this.#database = undefined;
        reject(new Error("Browser persistence database is blocked"));
      };
    });
    return this.#database;
  }

  async read(): Promise<string | undefined> {
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const value = await requestResult(transaction.objectStore(STORE_NAME).get(PRIMARY_KEY));
    await transactionComplete(transaction);
    return typeof value === "string" ? value : undefined;
  }

  async replace(serializedModel: string): Promise<void> {
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(serializedModel, PRIMARY_KEY);
    await transactionComplete(transaction);
  }

  async remove(): Promise<void> {
    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(PRIMARY_KEY);
    await transactionComplete(transaction);
  }
}
