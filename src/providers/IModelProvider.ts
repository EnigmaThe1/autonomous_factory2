import { ChatRequest } from "../types";

export interface IModelProvider {
  id: string;
  stream(req: ChatRequest): AsyncIterable<string>;
  /** Produce embedding vectors for the given texts. Not all providers support this. */
  embed?(texts: string[], model?: string): Promise<number[][]>;
}
