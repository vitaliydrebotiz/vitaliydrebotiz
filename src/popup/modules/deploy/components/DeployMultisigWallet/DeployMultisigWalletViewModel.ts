import type nt from '@wallet/nekoton-wasm'
import { autorun, makeAutoObservable, runInAction, when } from 'mobx'
import { Disposable, inject, injectable } from 'tsyringe'

import { DeployMessageToPrepare, Nekoton, WalletMessageToSend } from '@app/models'
import {
    AccountabilityStore,
    ConnectionStore,
    createEnumField,
    NekotonToken,
    RpcStore,
} from '@app/popup/modules/shared'
import { getScrollWidth, parseError, prepareKey, prepareLedgerSignatureContext } from '@app/popup/utils'
import { closeCurrentWindow, Logger, NATIVE_CURRENCY_DECIMALS } from '@app/shared'

import { MultisigData } from '../MultisigForm'

@injectable()
export class DeployMultisigWalletViewModel implements Disposable {

    public step = createEnumField<typeof Step>(Step.EnterData)

    public selectedAccount: nt.AssetsList | undefined

    public multisigData: MultisigData | undefined

    public loading = false

    public error = ''

    public fees = ''

    private estimateFeesDisposer: () => void

    private selectedAccountDisposer: () => void

    private ledgerCheckerDisposer: () => void

    constructor(
        @inject(NekotonToken) private nekoton: Nekoton,
        private rpcStore: RpcStore,
        private accountability: AccountabilityStore,
        private connectionStore: ConnectionStore,
        private logger: Logger,
    ) {
        makeAutoObservable(this, undefined, { autoBind: true })

        this.estimateFeesDisposer = autorun(async () => {
            if (this.isDeployed || !this.address) return

            try {
                const fees = await this.rpcStore.rpc.estimateDeploymentFees(this.address)

                runInAction(() => {
                    this.fees = fees
                })
            }
            catch (e) {
                this.logger.error(e)
            }
        })

        this.selectedAccountDisposer = when(() => !!this.accountability.selectedAccount, () => {
            this.selectedAccount = this.accountability.selectedAccount
        })

        this.ledgerCheckerDisposer = when(() => this.selectedDerivedKeyEntry?.signerName === 'ledger_key', async () => {
            try {
                await this.rpcStore.rpc.getLedgerMasterKey()
            }
            catch (e) {
                await this.rpcStore.rpc.openExtensionInExternalWindow({
                    group: 'ask_iframe',
                    width: 360 + getScrollWidth() - 1,
                    height: 600 + getScrollWidth() - 1,
                })
                window.close()
            }
        })
    }

    public dispose(): void {
        this.estimateFeesDisposer()
        this.selectedAccountDisposer()
        this.ledgerCheckerDisposer()
    }

    public get everWalletAsset(): nt.TonWalletAsset | undefined {
        return this.selectedAccount?.tonWallet
    }

    public get address(): string | undefined {
        return this.everWalletAsset?.address
    }

    public get isDeployed(): boolean {
        return this.everWalletState?.isDeployed ?? false
    }

    public get everWalletState(): nt.ContractState | undefined {
        return this.address ? this.accountability.accountContractStates[this.address] : undefined
    }

    public get selectedDerivedKeyEntry(): nt.KeyStoreEntry | undefined {
        return this.everWalletAsset ? this.accountability.storedKeys[this.everWalletAsset.publicKey] : undefined
    }

    public get masterKeysNames(): Record<string, string> {
        return this.accountability.masterKeysNames
    }

    public get nativeCurrency(): string {
        return this.connectionStore.symbol
    }

    public sendMessage(message: WalletMessageToSend): void {
        this.rpcStore.rpc.sendMessage(this.address!, message).catch(this.logger.error)
        closeCurrentWindow().catch(this.logger.error)
    }

    public async onSubmit(password?: string): Promise<void> {
        if (!this.selectedDerivedKeyEntry || !this.everWalletAsset) {
            throw new Error('Account not selected')
        }

        const keyPassword = prepareKey({
            password,
            keyEntry: this.selectedDerivedKeyEntry,
            wallet: this.everWalletAsset.contractType,
            context: prepareLedgerSignatureContext(this.nekoton, {
                type: 'deploy',
                everWallet: this.everWalletAsset,
                asset: this.nativeCurrency,
                decimals: NATIVE_CURRENCY_DECIMALS,
            }),
        })
        const params: DeployMessageToPrepare = {
            type: 'multiple_owners',
            custodians: this.multisigData?.custodians || [],
            reqConfirms: parseInt(this.multisigData?.reqConfirms as unknown as string, 10) || 0,
        }

        this.error = ''
        this.loading = true

        try {
            const signedMessage = await this.rpcStore.rpc.prepareDeploymentMessage(this.address!, params, keyPassword)

            this.sendMessage({ signedMessage, info: { type: 'deploy', data: undefined }})
        }
        catch (e) {
            runInAction(() => {
                this.error = parseError(e)
            })
        }
        finally {
            runInAction(() => {
                this.loading = false
            })
        }
    }

    public onNext(data: MultisigData): void {
        this.multisigData = data
        this.step.setValue(Step.DeployMessage)
    }

}

export enum Step {
    EnterData,
    DeployMessage,
}
