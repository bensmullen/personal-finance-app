import { executeForecastWorkerRequest } from "./execute.js";
import type { ForecastWorkerRequest, ForecastWorkerResponse, EvidenceWorkerRequest, EvidenceWorkerResponse, StandaloneWorkerRequest, StandaloneWorkerResponse } from "./protocol.js";

// A narrow port avoids mixing DOM and WebWorker library declarations.
const port = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ForecastWorkerRequest | EvidenceWorkerRequest | StandaloneWorkerRequest>) => void) | null;
  postMessage(response: ForecastWorkerResponse | EvidenceWorkerResponse | StandaloneWorkerResponse): void;
};
port.onmessage = (event) => {
  const response = executeForecastWorkerRequest(event.data, { now: () => performance.now() }, response => port.postMessage(response));
  port.postMessage(response);
};
