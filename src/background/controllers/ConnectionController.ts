import { Mutex } from '@broxus/await-semaphore'
import type {
    ClockWithOffset,
    EnumItem,
    GqlConnection,
    GqlQuery,
    JrpcConnection,
    JrpcQuery,
    Transport,
} from '@wallet/nekoton-wasm'
import browser from 'webextension-polyfill'

import { delay, throwError, TOKENS_MANIFEST_URL } from '@app/shared'
import {
    ConnectionData,
    ConnectionDataItem,
    UpdateCustomNetwork,
    GqlSocketParams,
    JrpcSocketParams,
    Nekoton,
    NekotonRpcError,
    RpcErrorCode,
} from '@app/models'

import { FetchCache } from '../utils/FetchCache'
import { BaseConfig, BaseController, BaseState } from './BaseController'

const ZEROSTATE_ADDRESSES = new Set([
    '-1:0000000000000000000000000000000000000000000000000000000000000000',
    '-1:1111111111111111111111111111111111111111111111111111111111111111',
    '-1:2222222222222222222222222222222222222222222222222222222222222222',
    '-1:3333333333333333333333333333333333333333333333333333333333333333',
    '-1:4444444444444444444444444444444444444444444444444444444444444444',
    '-1:5555555555555555555555555555555555555555555555555555555555555555',
    '-1:6666666666666666666666666666666666666666666666666666666666666666',
    '-1:7777777777777777777777777777777777777777777777777777777777777777',
    '-1:8888888888888888888888888888888888888888888888888888888888888888',
    '-1:9999999999999999999999999999999999999999999999999999999999999999',
    '-1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '-1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '-1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '-1:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '-1:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '-1:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
])

const DEFAULT_PRESETS: Record<number, ConnectionData> = {
    0: {
        name: 'Mainnet (JRPC)',
        networkId: 1,
        group: 'mainnet',
        type: 'jrpc',
        data: {
            endpoint: 'https://jrpc.everwallet.net/rpc',
        },
        config: {
            explorerBaseUrl: 'https://everscan.io',
            tokensManifestUrl: TOKENS_MANIFEST_URL,
        },
    } as ConnectionData,
    1: {
        name: 'Mainnet (GQL)',
        networkId: 1,
        group: 'mainnet',
        type: 'graphql',
        data: {
            endpoints: ['https://mainnet.evercloud.dev/89a3b8f46a484f2ea3bdd364ddaee3a3/graphql'],
            latencyDetectionInterval: 60000,
            local: false,
        },
        config: {
            explorerBaseUrl: 'https://everscan.io',
            tokensManifestUrl: TOKENS_MANIFEST_URL,
        },
    } as ConnectionData,
    4: {
        name: 'Testnet',
        networkId: 2,
        group: 'testnet',
        type: 'graphql',
        data: {
            endpoints: ['https://devnet.evercloud.dev/89a3b8f46a484f2ea3bdd364ddaee3a3/graphql'],
            latencyDetectionInterval: 60000,
            local: false,
        },
        config: {
            explorerBaseUrl: 'https://testnet.everscan.io',
        },
    } as ConnectionData,
    5: {
        name: 'FLD network',
        networkId: 10,
        group: 'fld',
        type: 'graphql',
        data: {
            endpoints: ['gql.custler.net'],
            latencyDetectionInterval: 60000,
            local: false,
        },
        config: {
            explorerBaseUrl: 'https://fld.ever.live',
        },
    } as ConnectionData,
    7: {
        name: 'RFLD network',
        networkId: 20,
        group: 'rfld',
        type: 'graphql',
        data: {
            endpoints: ['https://rfld-dapp.itgold.io/graphql'],
            latencyDetectionInterval: 60000,
            local: false,
        },
        config: {
            explorerBaseUrl: 'https://rfld.ever.live',
        },
    } as ConnectionData,
    100: {
        name: 'Local node',
        networkId: 31337,
        group: 'localnet',
        type: 'graphql',
        data: {
            endpoints: ['127.0.0.1'],
            latencyDetectionInterval: 60000,
            local: true,
        },
        config: {
            explorerBaseUrl: 'http://localhost',
        },
    } as ConnectionData,
}

export interface ConnectionConfig extends BaseConfig {
    nekoton: Nekoton;
    clock: ClockWithOffset;
    cache: FetchCache;
}

export interface ConnectionControllerState extends BaseState {
    clockOffset: number;
    selectedConnection: ConnectionDataItem;
    pendingConnection: ConnectionDataItem | undefined;
    failedConnection: ConnectionDataItem | undefined;
    networks: Record<number, ConnectionData>;
}

function makeDefaultState(): ConnectionControllerState {
    return {
        clockOffset: 0,
        selectedConnection: {
            ...DEFAULT_PRESETS[0],
            connectionId: 0,
        },
        pendingConnection: undefined,
        failedConnection: undefined,
        networks: DEFAULT_PRESETS,
    }
}

interface INetworkSwitchHandle {
    // Must be called after all connection usages are gone
    switch(): Promise<void>;
}

export class ConnectionController extends BaseController<ConnectionConfig, ConnectionControllerState> {

    private _customNetworks: Record<number, ConnectionData> = {}

    private _initializedConnection?: InitializedConnection

    // Used to prevent network switch during some working subscriptions
    private _networkMutex: Mutex

    private _release?: () => void

    private _acquiredConnectionCounter: number = 0

    private _cancelTestConnection?: () => void

    constructor(
        config: ConnectionConfig,
        state?: ConnectionControllerState,
    ) {
        super(config, state || makeDefaultState())

        this._initializedConnection = undefined
        this._networkMutex = new Mutex()
        this.initialize()
    }

    public get initialized(): boolean {
        return !!this._initializedConnection
    }

    public async initialSync() {
        if (this._initializedConnection) {
            throw new Error('Must not sync twice')
        }

        this._customNetworks = await this._loadCustomNetworks() ?? {}

        this._updateNetworks()

        await this._prepareTimeSync()

        let retry = 0
        while (retry++ < 2) {
            let loadedConnectionId = await this._loadSelectedConnectionId()
            if (loadedConnectionId === undefined) {
                loadedConnectionId = 0
            }

            const selectedConnection = this._getPreset(loadedConnectionId)
            if (selectedConnection != null) {
                this.update({ selectedConnection, pendingConnection: undefined })
            }

            try {
                await this.trySwitchingNetwork(this.state.selectedConnection, true)
                break
            }
            catch (_e) {
                console.error('Failed to select initial connection. Retrying in 5s')
            }

            if (retry < 2) {
                await delay(5000)
                console.debug('Restarting connection process')
            }
        }

        if (!this._initializedConnection) {
            this.update({
                failedConnection: this.state.selectedConnection,
            })
        }
    }

    public async startSwitchingNetwork(params: ConnectionDataItem): Promise<INetworkSwitchHandle> {
        class NetworkSwitchHandle implements INetworkSwitchHandle {

            private readonly _controller: ConnectionController

            private readonly _release: () => void

            private readonly _params: ConnectionDataItem

            constructor(
                controller: ConnectionController,
                release: () => void,
                params: ConnectionDataItem,
            ) {
                this._controller = controller
                this._release = release
                this._params = params

                this._controller.update({
                    pendingConnection: params,
                })
            }

            public async switch() {
                await this._controller
                    ._connect(this._params)
                    .then(() => {
                        this._controller.update({
                            selectedConnection: this._params,
                            pendingConnection: undefined,
                            failedConnection: undefined,
                        })
                    })
                    .catch(e => {
                        this._controller.update({
                            pendingConnection: undefined,
                        })
                        throw e
                    })
                    .finally(() => this._release())
            }

        }

        this._cancelTestConnection?.()

        const release = await this._networkMutex.acquire()
        return new NetworkSwitchHandle(this, release, params)
    }

    public async acquire() {
        requireInitializedConnection(this._initializedConnection)
        await this._acquireConnection()

        return {
            connection: this._initializedConnection,
            release: () => this._releaseConnection(),
        }
    }

    public async use<T>(f: (connection: InitializedConnection) => Promise<T>): Promise<T> {
        requireInitializedConnection(this._initializedConnection)
        await this._acquireConnection()

        return f(this._initializedConnection)
            .finally(() => this._releaseConnection())
    }

    public isFromZerostate(address: string): boolean {
        return ZEROSTATE_ADDRESSES.has(address)
    }

    public getAvailableNetworks(): ConnectionDataItem[] {
        return Object.entries(this.state.networks).map(([id, value]) => ({
            ...(value as ConnectionData),
            connectionId: parseInt(id, 10),
        }))
    }

    public makeAvailableNetworksGroup(first: ConnectionDataItem): ConnectionDataItem[] {
        const { networks } = this.state
        const availableConnections = [first]
        availableConnections.push(
            ...Object.entries(networks)
                .filter(([id, item]) => parseInt(id, 10) !== first.connectionId && item.group === first.group)
                .map(([id, item]) => ({
                    ...item,
                    connectionId: parseInt(id, 10),
                })),
        )
        return availableConnections
    }

    public async trySwitchingNetwork(first: ConnectionDataItem, allowOtherConnections: boolean) {
        const availableConnections = allowOtherConnections
            ? this.makeAvailableNetworksGroup(first)
            : [first]

        console.debug(availableConnections)

        for (const connection of availableConnections) {
            console.debug(`Connecting to ${connection.name} ...`)

            try {
                await this.startSwitchingNetwork(connection).then(handle => handle.switch())
                console.debug(`Successfully connected to ${this.state.selectedConnection.name}`)
                return
            }
            catch (e: any) {
                console.error('Connection failed:', e)
            }
        }

        throw new Error('Failed to find suitable connection')
    }

    public async updateCustomNetwork(update: UpdateCustomNetwork): Promise<ConnectionDataItem> {
        let { connectionId, ...params } = update, // eslint-disable-line prefer-const
            network: ConnectionData

        if (typeof connectionId === 'undefined') {
            // create new network
            connectionId = Math.max(
                1000,
                Object.keys(this._customNetworks)
                    .reduce((max, key) => Math.max(max, parseInt(key, 10)), 0) + 1,
            )
            network = {
                ...params,
                group: `custom-${connectionId}`,
            }
        }
        else {
            // update network
            const oldNetwork = this._customNetworks[connectionId]
                ?? DEFAULT_PRESETS[connectionId]
                ?? throwError(new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, 'Network not found'))

            network = {
                ...oldNetwork,
                ...update,
            }
        }

        // TODO: test connection?
        // let initializedConnection: InitializedConnection | undefined
        // try {
        //     initializedConnection = await this._initializeConnection(network)
        //     const testResult = await this._testConnection(initializedConnection, getTestType(network))
        //
        //     if (testResult !== ConnectionTestResult.DONE) {
        //         throw new Error()
        //     }
        // }
        // catch (e: any) {
        //     throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, 'Invalid endpoint')
        // }
        // finally {
        //     initializedConnection?.data.connection.free()
        // }

        this._customNetworks[connectionId] = network

        await this._saveCustomNetworks()

        this._updateNetworks()

        return {
            ...network,
            connectionId,
        }
    }

    public async deleteCustomNetwork(connectionId: number): Promise<void> {
        const { selectedConnection } = this.state
        const network = this._customNetworks[connectionId]

        if (!network) return

        if (selectedConnection.connectionId === connectionId) {
            throw new NekotonRpcError(RpcErrorCode.INTERNAL, 'Can\' delete selected network')
        }

        delete this._customNetworks[connectionId]
        await this._saveCustomNetworks()

        this._updateNetworks()
    }

    public async resetCustomNetworks(): Promise<void> {
        const { selectedConnection } = this.state

        if (!(selectedConnection.connectionId in DEFAULT_PRESETS)) {
            throw new NekotonRpcError(RpcErrorCode.INTERNAL, 'Custom network is selected')
        }

        this._customNetworks = {}

        await this._clearCustomNetworks()

        this._updateNetworks()
    }

    private async _prepareTimeSync() {
        const computeClockOffset = (): Promise<number> => new Promise<number>((resolve, reject) => {
            const now = Date.now()
            fetch('https://jrpc.everwallet.net')
                .then(body => {
                    const then = Date.now()
                    body.text().then(timestamp => {
                        const server = parseInt(timestamp, 10)
                        resolve(server - (now + then) / 2)
                    })
                })
                .catch(reject)
            setTimeout(() => reject(new Error('Clock offset resolution timeout')), 5000)
        }).catch(e => {
            console.warn('Failed to compute clock offset:', e)
            return 0
        })

        const updateClockOffset = async () => {
            const clockOffset = await computeClockOffset()
            console.debug(`Clock offset: ${clockOffset}`)
            this.config.clock.updateOffset(clockOffset)
            this.update({ clockOffset })
        }

        // NOTE: Update clock offset twice because first request is always too long
        await updateClockOffset()
        await updateClockOffset()

        let lastTime = Date.now()
        setInterval(() => {
            const currentTime = Date.now()
            if (Math.abs(currentTime - lastTime) > 2000) {
                updateClockOffset().catch(console.error)
            }
            lastTime = currentTime
        }, 1000)
    }

    private async _connect(params: ConnectionDataItem) {
        if (this._initializedConnection) {
            this._initializedConnection.data.transport.free()
            this._initializedConnection.data.connection.free()
        }

        this._initializedConnection = undefined

        if (params.type !== 'graphql' && params.type !== 'jrpc') {
            throw new NekotonRpcError(
                RpcErrorCode.RESOURCE_UNAVAILABLE,
                'Unsupported connection type',
            )
        }

        let initializedConnection: InitializedConnection | undefined

        try {
            initializedConnection = await this._initializeConnection(params)
            const testResult = await this._testConnection(initializedConnection, getTestType(params))

            if (testResult === ConnectionTestResult.CANCELLED) {
                initializedConnection?.data.connection.free()
                return
            }

            this._initializedConnection = initializedConnection
            await this._saveSelectedConnectionId(params.connectionId)
        }
        catch (e: any) {
            initializedConnection?.data.connection.free()
            throw new NekotonRpcError(
                RpcErrorCode.INTERNAL,
                `Failed to create connection: ${e.toString()}`,
            )
        }
    }

    private async _initializeConnection(params: ConnectionData): Promise<InitializedConnection> {
        let initializedConnection: InitializedConnection

        if (params.type === 'graphql') {
            const socket = new GqlSocket(this.config.nekoton)
            const connection = await socket.connect(this.config.clock, params.data)
            const transport = this.config.nekoton.Transport.fromGqlConnection(connection)

            initializedConnection = {
                networkId: params.networkId,
                group: params.group,
                type: 'graphql',
                data: {
                    socket,
                    connection,
                    transport,
                },
            }
        }
        else {
            const { nekoton, cache } = this.config
            const socket = new JrpcSocket(nekoton, cache)
            const connection = await socket.connect(this.config.clock, params.data)
            const transport = this.config.nekoton.Transport.fromJrpcConnection(connection)

            initializedConnection = {
                networkId: params.networkId,
                group: params.group,
                type: 'jrpc',
                data: {
                    socket,
                    connection,
                    transport,
                },
            }
        }

        return initializedConnection
    }

    private async _acquireConnection() {
        console.debug('_acquireConnection')

        if (this._acquiredConnectionCounter > 0) {
            console.debug('_acquireConnection -> increase')
            this._acquiredConnectionCounter += 1
        }
        else {
            this._acquiredConnectionCounter = 1
            if (this._release != null) {
                console.warn('mutex is already acquired')
            }
            else {
                console.debug('_acquireConnection -> await')
                this._release = await this._networkMutex.acquire()
                console.debug('_acquireConnection -> create')
            }
        }
    }

    private _releaseConnection() {
        console.debug('_releaseConnection')

        this._acquiredConnectionCounter -= 1
        if (this._acquiredConnectionCounter <= 0) {
            console.debug('_releaseConnection -> release')
            this._release?.()
            this._release = undefined
        }
    }

    private _getPreset(id: number): ConnectionDataItem | undefined {
        const preset = this.state.networks[id]
        return preset ? {
            ...preset,
            connectionId: id,
        } : undefined
    }

    private _testConnection = (
        connection: InitializedConnection,
        testType: ConnectionTestType,
    ) => new Promise<ConnectionTestResult>(
        (resolve, reject) => {
            const {
                data: { transport },
            } = connection
            const address = testType === ConnectionTestType.Local
                ? '0:78fbd6980c10cf41401b32e9b51810415e7578b52403af80dae68ddf99714498'
                : '-1:0000000000000000000000000000000000000000000000000000000000000000'
            this._cancelTestConnection = () => resolve(ConnectionTestResult.CANCELLED)

            // Try to get any account state
            transport
                .getFullContractState(address)
                .then(() => resolve(ConnectionTestResult.DONE))
                .catch((e: any) => reject(e))

            setTimeout(() => reject(new Error('Connection timeout')), 10000)
        },
    ).finally(() => {
        this._cancelTestConnection = undefined
    })

    private async _loadSelectedConnectionId(): Promise<number | undefined> {
        const { selectedConnectionId } = await browser.storage.local.get([
            'selectedConnectionId',
        ])
        if (typeof selectedConnectionId === 'number') {
            return selectedConnectionId
        }
        return undefined
    }

    private async _saveSelectedConnectionId(connectionId: number): Promise<void> {
        await browser.storage.local.set({ selectedConnectionId: connectionId })
    }

    private async _loadCustomNetworks(): Promise<Record<number, ConnectionData> | undefined> {
        const { customNetworks } = await browser.storage.local.get('customNetworks')

        if (customNetworks && typeof customNetworks === 'object') {
            return customNetworks
        }

        return undefined
    }

    private async _clearCustomNetworks(): Promise<void> {
        await browser.storage.local.remove('customNetworks')
    }

    private async _saveCustomNetworks(): Promise<void> {
        await browser.storage.local.set({ customNetworks: this._customNetworks })
    }

    private _updateNetworks(): void {
        Object.values(this._customNetworks).forEach((network) => {
            network.custom = true
        })

        this.update({
            networks: {
                ...DEFAULT_PRESETS,
                ...this._customNetworks,
            },
        })
    }

}

type InitializedConnection = { networkId: number; group: string; } & (
    | EnumItem<'graphql', {
    socket: GqlSocket
    connection: GqlConnection
    transport: Transport
}>
    | EnumItem<'jrpc', {
    socket: JrpcSocket
    connection: JrpcConnection
    transport: Transport
}>
    );

enum ConnectionTestType {
    Default,
    Local,
}

enum ConnectionTestResult {
    DONE,
    CANCELLED,
}

function requireInitializedConnection(
    connection?: InitializedConnection,
): asserts connection is InitializedConnection {
    if (connection == null) {
        throw new NekotonRpcError(
            RpcErrorCode.CONNECTION_IS_NOT_INITIALIZED,
            'Connection is not initialized',
        )
    }
}

function getTestType(params: ConnectionData): ConnectionTestType {
    return (params.type === 'graphql' && params.data.local) ? ConnectionTestType.Local : ConnectionTestType.Default
}

class GqlSocket {

    constructor(private nekoton: Nekoton) {
    }

    public async connect(clock: ClockWithOffset, params: GqlSocketParams): Promise<GqlConnection> {
        class GqlSender {

            private readonly params: GqlSocketParams

            private readonly endpoints: string[]

            private nextLatencyDetectionTime: number = 0

            private currentEndpoint?: string

            private resolutionPromise?: Promise<string>

            constructor(params: GqlSocketParams) {
                this.params = params
                this.endpoints = params.endpoints.map(GqlSocket.expandAddress)
                if (this.endpoints.length === 1) {
                    // eslint-disable-next-line prefer-destructuring
                    this.currentEndpoint = this.endpoints[0]
                    this.nextLatencyDetectionTime = Number.MAX_VALUE
                }
            }

            isLocal(): boolean {
                return this.params.local
            }

            send(data: string, handler: GqlQuery) {
                (async () => {
                    const now = Date.now()
                    try {
                        let endpoint: string
                        if (this.currentEndpoint != null && now < this.nextLatencyDetectionTime) {
                            // Default route
                            endpoint = this.currentEndpoint
                        }
                        else if (this.resolutionPromise != null) {
                            // Already resolving
                            endpoint = await this.resolutionPromise
                            delete this.resolutionPromise
                        }
                        else {
                            delete this.currentEndpoint
                            // Start resolving (current endpoint is null, or it is time to refresh)
                            this.resolutionPromise = this._selectQueryingEndpoint().then(
                                endpoint => {
                                    this.currentEndpoint = endpoint
                                    this.nextLatencyDetectionTime = Date.now() + this.params.latencyDetectionInterval
                                    return endpoint
                                },
                            )
                            endpoint = await this.resolutionPromise
                            delete this.resolutionPromise
                        }

                        const response = await fetch(endpoint, {
                            method: 'post',
                            headers: HEADERS,
                            body: data,
                        }).then(response => response.text())
                        handler.onReceive(response)
                    }
                    catch (e: any) {
                        handler.onError(e)
                    }
                })()
            }

            private async _selectQueryingEndpoint(): Promise<string> {
                for (let retryCount = 0; retryCount < 5; ++retryCount) {
                    try {
                        return await this._getOptimalEndpoint()
                    }
                    catch (e: any) {
                        await delay(Math.min(100 * retryCount, 5000))
                    }
                }

                throw new Error('No available endpoint found')
            }

            private _getOptimalEndpoint(): Promise<string> {
                return new Promise<string>((resolve, reject) => {
                    const maxLatency = this.params.maxLatency || 60000
                    const endpointCount = this.endpoints.length
                    let checkedEndpoints = 0,
                        lastLatency: { endpoint: string; latency: number | undefined } | undefined

                    for (const endpoint of this.endpoints) {
                        // eslint-disable-next-line no-loop-func
                        GqlSocket.checkLatency(endpoint).then(latency => {
                            ++checkedEndpoints

                            if (latency !== undefined && latency <= maxLatency) {
                                resolve(endpoint)
                                return
                            }

                            if (
                                lastLatency?.latency === undefined
                                || (latency !== undefined && latency < lastLatency.latency)
                            ) {
                                lastLatency = { endpoint, latency }
                            }

                            if (checkedEndpoints >= endpointCount) {
                                if (lastLatency?.latency !== undefined) {
                                    resolve(lastLatency.endpoint)
                                }
                                else {
                                    reject()
                                }
                            }
                        })
                    }
                })
            }

        }

        return new this.nekoton.GqlConnection(clock, new GqlSender(params))
    }

    static async checkLatency(endpoint: string): Promise<number | undefined> {
        const response = await fetch(`${endpoint}?query=%7Binfo%7Bversion%20time%20latency%7D%7D`, {
            method: 'get',
        })
            .then(response => response.json())
            .catch((e: any) => {
                console.error(e)
                return undefined
            })

        if (typeof response !== 'object') {
            return
        }

        const { data } = response
        if (typeof data !== 'object') {
            return
        }

        const { info } = data
        if (typeof info !== 'object') {
            return
        }

        const { latency } = info
        if (typeof latency !== 'number') {
            return
        }

        // eslint-disable-next-line consistent-return
        return latency
    }

    static expandAddress = (_baseUrl: string): string => {
        const lastBackslashIndex = _baseUrl.lastIndexOf('/')
        const baseUrl = lastBackslashIndex < 0 ? _baseUrl : _baseUrl.substr(0, lastBackslashIndex)

        if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
            return `${baseUrl}/graphql`
        }
        if (['localhost', '127.0.0.1'].indexOf(baseUrl) >= 0) {
            return `http://${baseUrl}/graphql`
        }
        return `https://${baseUrl}/graphql`
    }

}

class JrpcSocket {

    constructor(
        private nekoton: Nekoton,
        private cache: FetchCache,
    ) {
    }

    public async connect(clock: ClockWithOffset, params: JrpcSocketParams): Promise<JrpcConnection> {
        class JrpcSender {

            private readonly params: JrpcSocketParams

            private readonly cache: FetchCache

            constructor(params: JrpcSocketParams, cache: FetchCache) {
                this.params = params
                this.cache = cache
            }

            send(data: string, handler: JrpcQuery) {
                (async () => {
                    try {
                        const key = this.cache.getKey({
                            url: this.params.endpoint,
                            method: 'post',
                            body: data,
                        })
                        const cachedValue = await this.cache.get(key)

                        if (cachedValue) {
                            handler.onReceive(cachedValue)
                            return
                        }

                        const response = await fetch(this.params.endpoint, {
                            method: 'post',
                            headers: HEADERS,
                            body: data,
                        })
                        const text = await response.text()

                        if (response.ok) {
                            const ttl = this.cache.getTtlFromHeaders(response.headers)

                            if (ttl) {
                                await this.cache.set(key, text, { ttl })
                            }
                        }

                        handler.onReceive(text)
                    }
                    catch (e: any) {
                        handler.onError(e)
                    }
                })()
            }

        }

        return new this.nekoton.JrpcConnection(clock, new JrpcSender(params, this.cache))
    }

}

const HEADERS: HeadersInit = { 'Content-Type': 'application/json' }
