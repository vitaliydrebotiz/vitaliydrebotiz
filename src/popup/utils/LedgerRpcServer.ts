import { Duplex } from 'readable-stream'

import { IBridgeApi, IBridgeResponse, NekotonRpcError, RpcErrorCode } from '@app/models'
import { JsonRpcFailure, JsonRpcRequest, LEDGER_BRIDGE_URL } from '@app/shared'

export class LedgerRpcServer {

    private iframe: HTMLIFrameElement | undefined

    constructor(private stream: Duplex) {
        stream.on('data', this.handleData)
    }

    private handleData = async (data: JsonRpcRequest<unknown>) => {
        const { id, method, params } = data
        let result: IBridgeResponse<any> | undefined

        try {
            if (method === 'initialize') {
                this.iframe = await this.setupIframe()
            }
            else {
                result = await this.sendMessage(method as any, params as any)

                if (result.error) {
                    result.error = {
                        name: result.error.name,
                        message: result.error.message,
                    }
                }
            }

            this.stream.write({
                jsonrpc: '2.0',
                id,
                result,
            })
        }
        catch (error) {
            this.stream.write(<JsonRpcFailure>{
                jsonrpc: '2.0',
                id,
                error,
            })
        }
    }

    private setupIframe = (): Promise<HTMLIFrameElement> => new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe')
        iframe.src = LEDGER_BRIDGE_URL
        iframe.allow = 'hid'
        iframe.style.display = 'none'
        iframe.onload = () => resolve(iframe)
        iframe.onerror = e => reject(e)

        document.body.appendChild(iframe)
    })

    private sendMessage = <T extends keyof IBridgeApi>(
        action: T,
        params: IBridgeApi[T]['input'],
    ): Promise<IBridgeResponse<T>> => new Promise<IBridgeResponse<T>>((resolve, reject) => {
        const message = {
            target: 'LEDGER-IFRAME',
            action,
            params,
        }

        if ('message' in params) {
            params.message = Uint8Array.from(Object.values(params.message))
        }

        const eventListener = ({ origin, data }: MessageEvent) => {
            if (origin !== this.getOrigin()) {
                reject(new NekotonRpcError(RpcErrorCode.INTERNAL, 'Invalid origin'))
            }
            else if (data?.action !== `${message.action}-reply`) {
                reject(new NekotonRpcError(RpcErrorCode.INTERNAL, 'Invalid reply'))
            }
            else {
                resolve(data)
            }
        }

        window.addEventListener('message', eventListener, { once: true })

        this.iframe?.contentWindow?.postMessage(message, '*')
    })

    private getOrigin() {
        return new URL(LEDGER_BRIDGE_URL).origin
    }

}
