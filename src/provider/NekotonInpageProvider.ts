import { NekotonRpcError, RpcErrorCode } from '@app/models';
import {
  ConsoleLike,
  createErrorMiddleware,
  createIdRemapMiddleware,
  createStreamMiddleware,
  getRpcPromiseCallback,
  JsonRpcEngine,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcVersion,
  logStreamDisconnectWarning,
  Maybe,
  NEKOTON_PROVIDER,
  SafeEventEmitter,
} from '@app/shared';
import { isDuplexStream } from 'is-stream';
import ObjectMultiplex from 'obj-multiplex';
import pump from 'pump';
import type { Duplex } from 'readable-stream';

interface UnvalidatedJsonRpcRequest {
  id?: JsonRpcId;
  jsonrpc?: JsonRpcVersion;
  method: string;
  params?: unknown;
}

export interface NekotonInpageProviderOptions {
  jsonRpcStreamName?: string;
  logger?: ConsoleLike;
  maxEventListeners?: number;
}

export interface RequestArguments {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

export class NekotonInpageProvider<S extends Duplex> extends SafeEventEmitter {
  private readonly _log: ConsoleLike;
  private _rpcEngine: JsonRpcEngine;

  constructor(
    connectionStream: S,
    {
      jsonRpcStreamName = NEKOTON_PROVIDER,
      logger = console,
      maxEventListeners = 100,
    }: NekotonInpageProviderOptions,
  ) {
    super();

    if (!isDuplexStream(connectionStream)) {
      throw new Error('Invalid duplex stream');
    }

    validateLoggerObject(logger);
    this._log = logger;

    this.setMaxListeners(maxEventListeners);

    const mux = new ObjectMultiplex();
    pump(
      connectionStream,
      mux as unknown as Duplex,
      connectionStream,
      this._handleStreamDisconnect.bind(this, 'Nekoton'),
    );

    const jsonRpcConnection = createStreamMiddleware();
    pump(
      jsonRpcConnection.stream,
      mux.createStream(jsonRpcStreamName) as unknown as Duplex,
      jsonRpcConnection.stream,
      this._handleStreamDisconnect.bind(this, 'Nekoton RpcProvider'),
    );

    const rpcEngine = new JsonRpcEngine();
    rpcEngine.push(createIdRemapMiddleware());
    rpcEngine.push(createErrorMiddleware(this._log));
    rpcEngine.push(jsonRpcConnection.middleware);
    this._rpcEngine = rpcEngine;

    jsonRpcConnection.events.on('notification', (payload) => {
      const { method, params } = payload;

      this._log.debug('Got notification: ', method, params);

      if (method === 'NEKOTON_STREAM_FAILURE') {
        connectionStream.destroy(new Error('Permanently disconnected'));
      } else {
        this.emit(method, params);
      }
    });

    if (document.readyState !== 'loading') {
      sendSiteMetadata(this._rpcEngine, this._log).catch(() => {
      });
    } else {
      const domContentLoadedHandler = () => {
        sendSiteMetadata(this._rpcEngine, this._log).catch(() => {});
      };
      window.addEventListener('DOMContentLoaded', domContentLoadedHandler, { once: true });
    }
  }

  public async request<T>(args: RequestArguments): Promise<Maybe<T>> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, 'Invalid request args');
    }

    const { method, params } = args;

    if (method.length === 0) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, 'Invalid request method');
    }

    if (
      params !== undefined &&
      !Array.isArray(params) &&
      (typeof params !== 'object' || params === null)
    ) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, 'Invalid request params');
    }

    return new Promise<T>((resolve, reject) => {
      this._rpcRequest({ method, params }, getRpcPromiseCallback(resolve, reject));
    });
  }

  public sendAsync(
    payload: JsonRpcRequest<unknown>,
    callback: (error: Error | null, response?: JsonRpcResponse<unknown>) => void,
  ) {
    this._rpcRequest(payload, callback);
  }

  public addListener(eventName: string, listener: (...args: unknown[]) => void) {
    return super.addListener(eventName, listener);
  }

  public removeListener(eventName: string, listener: (...args: unknown[]) => void) {
    return super.removeListener(eventName, listener);
  }

  public on(eventName: string, listener: (...args: unknown[]) => void) {
    return super.on(eventName, listener);
  }

  public once(eventName: string, listener: (...args: unknown[]) => void) {
    return super.once(eventName, listener);
  }

  public prependListener(eventName: string, listener: (...args: unknown[]) => void) {
    return super.prependListener(eventName, listener);
  }

  public prependOnceListener(eventName: string, listener: (...args: unknown[]) => void) {
    return super.prependOnceListener(eventName, listener);
  }

  private _rpcRequest = (
    payload: UnvalidatedJsonRpcRequest | UnvalidatedJsonRpcRequest[],
    callback: (...args: any[]) => void,
  ) => {
    if (!Array.isArray(payload)) {
      if (!payload.jsonrpc) {
        payload.jsonrpc = '2.0';
      }
      return this._rpcEngine.handle(payload as JsonRpcRequest<unknown>, callback);
    }
    return this._rpcEngine.handle(payload as JsonRpcRequest<unknown>[], callback);
  };

  private _handleDisconnect = (isRecoverable: boolean, errorMessage?: string) => {
    let error;
    if (isRecoverable) {
      error = new NekotonRpcError(
        RpcErrorCode.TRY_AGAIN_LATER,
        errorMessage || 'Disconnected',
      );
    } else {
      error = new NekotonRpcError(
        RpcErrorCode.INTERNAL,
        errorMessage || 'Permanently disconnected',
      );
    }

    this.emit('disconnected', error);
  };

  private _handleStreamDisconnect = (streamName: string, error: Error | undefined) => {
    logStreamDisconnectWarning(this._log, streamName, error, this);
    this._handleDisconnect(false, error?.message);
  };
}

const validateLoggerObject = (logger: ConsoleLike) => {
  if (logger !== console) {
    if (typeof logger === 'object') {
      const methodKeys = ['log', 'warn', 'error', 'debug', 'info', 'trace'];
      for (const key of methodKeys) {
        if (typeof logger[key as keyof ConsoleLike] !== 'function') {
          throw new Error(`Invalid logger method: "${key}"`);
        }
      }
      return;
    }
    throw new Error('Invalid logger object');
  }
};

const getSiteName = (windowObject: typeof window): string => {
  const { document } = windowObject;

  const siteName: HTMLMetaElement | null = document.querySelector(
    'head > meta[property="og:site_name"]',
  );
  if (siteName) {
    return siteName.content;
  }

  const metaTitle: HTMLMetaElement | null = document.querySelector('head > meta[name="title"]');
  if (metaTitle) {
    return metaTitle.content;
  }

  if (document.title && document.title.length > 0) {
    return document.title;
  }

  return window.location.hostname;
};

const imgExists = (url: string): Promise<boolean> => new Promise<boolean>((resolve, reject) => {
  try {
    const img = document.createElement('img');
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  } catch (e) {
    reject(e);
  }
});

const getSiteIcon = async (windowObject: typeof window): Promise<string | null> => {
  const { document } = windowObject;
  const icons = document.querySelectorAll<HTMLLinkElement>('head > link[rel~="icon"]');
  for (const icon of icons) {
    if (icon && (await imgExists(icon.href))) {
      return icon.href;
    }
  }
  return null;
};

const getSiteMetadata = async () => ({
  name: getSiteName(window),
  icon: await getSiteIcon(window),
});

const sendSiteMetadata = async (engine: JsonRpcEngine, log: ConsoleLike): Promise<void> => {
  try {
    const domainMetadata = await getSiteMetadata();
    engine.handle(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendDomainMetadata',
        params: domainMetadata,
      },
      () => {
      },
    );
  } catch (error) {
    log.error({
      message: 'Failed to send site metadata',
      originalError: error,
    });
  }
};
