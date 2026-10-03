import { executeForecastWorkerRequest } from "./execute.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse } from "./protocol.js";

// A narrow port avoids mixing DOM and WebWorker library declarations.
const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ForecastWorkerRequest>) => void) | null;
  postMessage(response: ForecastWorkerResponse): void;
};
port.onmessage = (event) => {
  const response = executeForecastWorkerRequest(event.data, { now: () => performance.now() });
  port.postMessage(response);
};
