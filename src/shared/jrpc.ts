import { NekotonRpcError, RpcErrorCode } from '@app/models';
import type { Duplex } from 'readable-stream';
import { getUniqueId, jsonify, JsonRpcError, Maybe, SafeEventEmitter, serializeError } from './utils';

export type JsonRpcVersion = '2.0';
export type JsonRpcId = number | string | void;

export interface JsonRpcRequest<T> {
  jsonrpc: JsonRpcVersion;
  method: string;
  id: JsonRpcId;
  params?: T;
}

export interface JsonRpcNotification<T> {
  jsonrpc: JsonRpcVersion;
  method: string;
  params?: T;
}

interface JsonRpcResponseBase {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
}

export interface JsonRpcSuccess<T> extends JsonRpcResponseBase {
  result: Maybe<T>;
}

export interface JsonRpcFailure extends JsonRpcResponseBase {
  error: JsonRpcError;
}

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

export interface PendingJsonRpcResponse<T> extends JsonRpcResponseBase {
  result?: T;
  error?: Error | JsonRpcError;
}

export type JsonRpcEngineCallbackError = Error | JsonRpcError | null;

export type JsonRpcEngineReturnHandler = (
  done: (error?: JsonRpcEngineCallbackError) => void,
) => void;

export type JsonRpcEngineNextCallback = (returnHandlerCallback?: JsonRpcEngineReturnHandler) => void;

export type JsonRpcEngineEndCallback = (error?: JsonRpcEngineCallbackError) => void;

export type JsonRpcMiddleware<T, U> = (
  req: JsonRpcRequest<T>,
  res: PendingJsonRpcResponse<U>,
  next: JsonRpcEngineNextCallback,
  end: JsonRpcEngineEndCallback,
) => void;

export interface DestroyableMiddleware {
  destroy(): void;
}

type InputType<T, K extends keyof T> = T[K] extends { input: infer I } ? I : never;
type OutputType<T, K extends keyof T> = T[K] extends { output: infer U } ? U : never;

export interface JsonRpcApiClient<T> {
  request<K extends keyof T>(method: K, params?: InputType<T, K>): Promise<OutputType<T, K>>;
}

type RequestCallback = (error: any | undefined, result?: unknown) => void;

export class JsonRpcClient {
  private requests = new Map<number | string, RequestCallback>();
  private events = new SafeEventEmitter();

  constructor(public stream: Duplex) {
    stream.on('data', (data: JsonRpcResponse<unknown>) => {
      if (!data.id) {
        this.events.emit('notification', data);
        return;
      }

      if (!this.requests.has(data.id)) {
        console.warn(`[JsonRpcClient] request id not found: ${data.id}`);
        return;
      }

      const callback = this.requests.get(data.id)!;

      this.requests.delete(data.id);

      if ('error' in data) {
        const error = data.error;
        const e = new NekotonRpcError(error.code, error.message, error.data);

        callback(e);
      } else {
        callback(undefined, data.result);
      }
    });

    stream.on('end', () => {
      for (const callback of this.requests.values()) {
        callback(new Error('[JsonRpcClient] stream ended before response'));
      }

      this.requests.clear();
    });
  }

  request<P, R>(method: string, params?: P): Promise<R> {
    if (this.stream.destroyed) {
      throw new Error('[JsonRpcClient] stream is destroyed');
    }

    return new Promise((resolve, reject) => {
      const id = getUniqueId();

      this.requests.set(id, (error: any | undefined, result?: unknown) => {
        if (error) {
          reject(error);
        } else {
          resolve(result as R);
        }
      });

      this.stream.write(<JsonRpcRequest<P>>{ jsonrpc: '2.0', method, params, id });
    });
  }

  public onNotification(listener: (data: JsonRpcNotification<unknown>) => void): void {
    this.events.addListener('notification', listener);
  }
}

export class JsonRpcEngine extends SafeEventEmitter {
  private readonly _middleware: JsonRpcMiddleware<unknown, unknown>[];

  constructor() {
    super();
    this._middleware = [];
  }

  get middleware(): JsonRpcMiddleware<unknown, unknown>[] {
    return this._middleware;
  }

  push<T, U>(middleware: JsonRpcMiddleware<T, U>) {
    this._middleware.push(middleware as JsonRpcMiddleware<unknown, unknown>);
  }

  handle<T, U>(request: JsonRpcRequest<T>, callback: (error: unknown, response: JsonRpcResponse<U>) => void): void;
  handle<T, U>(requests: JsonRpcRequest<T>[], callback: (error: unknown, responses: JsonRpcResponse<U>[]) => void): void;
  handle<T, U>(request: JsonRpcRequest<T>): Promise<JsonRpcResponse<U>>;
  handle<T, U>(requests: JsonRpcRequest<T>[]): Promise<JsonRpcResponse<U>[]>;
  handle(request: unknown, callback?: any) {
    if (callback && typeof callback !== 'function') {
      throw new Error('"callback" must be a function if provided');
    }

    if (Array.isArray(request)) {
      if (callback) {
        return this._handleBatch(request, callback);
      }
      return this._handleBatch(request);
    }

    if (callback) {
      return this._handle(request as JsonRpcRequest<unknown>, callback);
    }

    return this._promiseHandle(request as JsonRpcRequest<unknown>);
  }

  asMiddleware(): JsonRpcMiddleware<unknown, unknown> {
    return async (req, res, next, end) => {
      try {
        const [middlewareError, isComplete, returnHandlers] = await JsonRpcEngine._runAllMiddleware(req, res, this._middleware);

        if (isComplete) {
          await JsonRpcEngine._runReturnHandlers(returnHandlers);
          return end(middlewareError as JsonRpcEngineCallbackError);
        }

        return next(async (handlerCallback) => {
          try {
            await JsonRpcEngine._runReturnHandlers(returnHandlers);
          } catch (e: any) {
            return handlerCallback(e);
          }
          return handlerCallback();
        });
      } catch (e: any) {
        return end(e);
      }
    };
  }

  destroy(): void {
    for (const middleware of this._middleware) {
      if (isDestroyableMiddleware(middleware)) {
        middleware.destroy();
      }
    }
  }

  private _handleBatch(requests: JsonRpcRequest<unknown>[]): Promise<JsonRpcResponse<unknown>[]>;

  private _handleBatch(
    requests: JsonRpcRequest<unknown>[],
    callback: (error: unknown, responses?: JsonRpcResponse<unknown>[]) => void,
  ): Promise<void>;

  private async _handleBatch(
    requests: JsonRpcRequest<unknown>[],
    callback?: (error: unknown, responses?: JsonRpcResponse<unknown>[]) => void,
  ): Promise<JsonRpcResponse<unknown>[] | void> {
    try {
      const responses = await Promise.all(requests.map(this._promiseHandle.bind(this)));

      if (callback) {
        return callback(null, responses);
      }

      return responses;
    } catch (e: any) {
      if (callback) {
        return callback(e);
      }

      throw e;
    }
  }

  private _promiseHandle(request: JsonRpcRequest<unknown>): Promise<JsonRpcResponse<unknown>> {
    return new Promise((resolve) => {
      this._handle(request, (_err, res) => {
        resolve(res);
      });
    });
  }

  private async _handle(
    callerRequest: JsonRpcRequest<unknown>,
    callback: (error: unknown, response: JsonRpcResponse<unknown>) => void,
  ): Promise<void> {
    if (!callerRequest || Array.isArray(callerRequest) || typeof callerRequest !== 'object') {
      const error = new NekotonRpcError(
        RpcErrorCode.INVALID_REQUEST,
        `Requets must be plain objects. Received: ${typeof callerRequest}`,
        { request: callerRequest },
      );
      return callback(error, { id: undefined, jsonrpc: '2.0', error });
    }

    if ((typeof callerRequest.method as any) !== 'string') {
      const error = new NekotonRpcError(
        RpcErrorCode.INVALID_REQUEST,
        `Must specify a string method. Received: ${typeof callerRequest.method}`,
        { request: callerRequest },
      );
      return callback(error, { id: callerRequest.id, jsonrpc: '2.0', error });
    }

    const request: JsonRpcRequest<unknown> = { ...callerRequest };
    const response: PendingJsonRpcResponse<unknown> = {
      id: request.id,
      jsonrpc: request.jsonrpc,
    };
    let error: JsonRpcEngineCallbackError = null;

    try {
      await this._processRequest(request, response);
    } catch (e: any) {
      error = e;
    }

    if (error) {
      delete response.result;
      if (!response.error) {
        response.error = serializeError(error);
      }
    }

    return callback(error, response as JsonRpcResponse<unknown>);
  }

  private async _processRequest(
    request: JsonRpcRequest<unknown>,
    response: PendingJsonRpcResponse<unknown>,
  ): Promise<void> {
    const [error, isComplete, returnHandlers] = await JsonRpcEngine._runAllMiddleware(
      request,
      response,
      this._middleware,
    );

    JsonRpcEngine._checkForCompletion(request, response, isComplete);
    await JsonRpcEngine._runReturnHandlers(returnHandlers);

    if (error) {
      throw error;
    }
  }

  private static async _runAllMiddleware(
    request: JsonRpcRequest<unknown>,
    response: PendingJsonRpcResponse<unknown>,
    middlewareStack: JsonRpcMiddleware<unknown, unknown>[],
  ): Promise<[unknown, boolean, JsonRpcEngineReturnHandler[]]> {
    const returnHandlers: JsonRpcEngineReturnHandler[] = [];
    let error = null;
    let isComplete = false;

    for (const middleware of middlewareStack) {
      [error, isComplete] = await JsonRpcEngine._runMiddleware(
        request,
        response,
        middleware,
        returnHandlers,
      );
      if (isComplete) {
        break;
      }
    }
    return [error, isComplete, returnHandlers.reverse()];
  }

  private static async _runMiddleware(
    request: JsonRpcRequest<unknown>,
    response: PendingJsonRpcResponse<unknown>,
    middleware: JsonRpcMiddleware<unknown, unknown>,
    returnHandlers: JsonRpcEngineReturnHandler[],
  ): Promise<[unknown, boolean]> {
    return new Promise((resolve) => {
      const end: JsonRpcEngineEndCallback = (e?: unknown) => {
        const error = e || response.error;
        if (error) {
          response.error = serializeError(error);
        }
        resolve([error, true]);
      };

      const next: JsonRpcEngineNextCallback = (returnHandler) => {
        if (response.error) {
          end(response.error);
        } else {
          if (returnHandler) {
            if (typeof returnHandler !== 'function') {
              end(
                new NekotonRpcError(
                  RpcErrorCode.INTERNAL,
                  `JsonRpcEngine: "next" return handlers must be functions. Received "${typeof returnHandler}" for request:\n${jsonify(
                    request,
                  )}`,
                  { request },
                ),
              );
            }

            returnHandlers.push(returnHandler);
          }

          resolve([null, false]);
        }
      };

      try {
        middleware(request, response, next, end);
      } catch (e: any) {
        end(e);
      }
    });
  }

  private static async _runReturnHandlers(handlers: JsonRpcEngineReturnHandler[]): Promise<void> {
    for (const handler of handlers) {
      await new Promise<void>((resolve, reject) => {
        handler((e) => (e ? reject(e) : resolve()));
      });
    }
  }

  private static _checkForCompletion(
    request: JsonRpcRequest<unknown>,
    response: PendingJsonRpcResponse<unknown>,
    isComplete: boolean,
  ) {
    if (!('result' in response) && !('error' in response)) {
      throw new NekotonRpcError(
        RpcErrorCode.INTERNAL,
        `JsonRpcEngine: Response has no error or result for request: \n${jsonify(request)}`,
        { request },
      );
    }
    if (!isComplete) {
      throw new NekotonRpcError(
        RpcErrorCode.INTERNAL,
        `JsonRpcEngine: Nothing ended request:\n${jsonify(request)}`,
        { request },
      );
    }
  }
}

function isDestroyableMiddleware(middleware: any): middleware is DestroyableMiddleware {
  return middleware.destroy === 'function';
}

export const createMetaRPCHandler = <T extends {}, S extends Duplex>(api: T, outStream: S) => (data: JsonRpcRequest<unknown[]>) => {
  type MethodName = keyof T;

  if (api[data.method as MethodName] == null) {
    outStream.write(<JsonRpcFailure>{
      jsonrpc: '2.0',
      error: serializeError(
        new NekotonRpcError(RpcErrorCode.METHOD_NOT_FOUND, `${data.method} not found`),
      ),
      id: data.id,
    });
    return;
  }

  (api[data.method as MethodName] as any)(
    ...(data.params || []),
    <T>(error: Error | undefined, result: T) => {
      if (outStream.destroyed) {
        console.warn('write after stream end');
        return;
      }

      if (error) {
        outStream.write(<JsonRpcFailure>{
          jsonrpc: '2.0',
          error: serializeError(error, { shouldIncludeStack: true }),
          id: data.id,
        });
      } else {
        outStream.write(<JsonRpcSuccess<T>>{
          jsonrpc: '2.0',
          result,
          id: data.id,
        });
      }
    },
  );
};
