import type nt from '@wallet/nekoton-wasm'
import { makeAutoObservable, runInAction } from 'mobx'
import { injectable } from 'tsyringe'

import { PendingApproval } from '@app/models'
import { AccountabilityStore, LocalizationStore, RpcStore } from '@app/popup/modules/shared'
import { ignoreCheckPassword, parseError, prepareKey } from '@app/popup/utils'

import { ApprovalStore } from '../../store'
import { DataConverter, DisplayType } from '../../utils'

@injectable()
export class ApproveSignDataViewModel {

    public displayType = DisplayType.Base64

    public passwordModalVisible = false

    public submitted = false

    public loading = false

    public error = ''

    constructor(
        private rpcStore: RpcStore,
        private approvalStore: ApprovalStore,
        private accountability: AccountabilityStore,
        private localization: LocalizationStore,
        private converter: DataConverter,
    ) {
        makeAutoObservable<ApproveSignDataViewModel, any>(this, {
            rpcStore: false,
            approvalStore: false,
            accountability: false,
            localization: false,
            converter: false,
        }, { autoBind: true })
    }

    public get approval(): PendingApproval<'signData'> {
        return this.approvalStore.approval as PendingApproval<'signData'>
    }

    public get networkName(): string {
        return this.rpcStore.state.selectedConnection.name
    }

    public get keyEntry(): nt.KeyStoreEntry {
        return this.accountability.storedKeys[this.approval.requestData.publicKey]
    }

    public get masterKeysNames(): Record<string, string> {
        return this.accountability.masterKeysNames
    }

    public get account(): nt.AssetsList | undefined {
        return Object.values(this.accountability.accountEntries).find(
            account => account.tonWallet.publicKey === this.approval.requestData.publicKey,
        )
    }

    public get data(): string {
        return this.converter.convert(
            this.approval.requestData.data,
            this.displayType,
        )
    }

    public openPasswordModal(): void {
        this.passwordModalVisible = true
    }

    public closePasswordModal(): void {
        this.passwordModalVisible = false
    }

    public setDisplayType(displayType: DisplayType): void {
        this.displayType = displayType
    }

    public async onReject(): Promise<void> {
        this.loading = true
        await this.approvalStore.rejectPendingApproval()
    }

    public async onSubmit(password?: string, cache?: boolean): Promise<void> {
        if (!this.keyEntry) {
            this.error = this.localization.intl.formatMessage({ id: 'ERROR_KEY_ENTRY_NOT_FOUND' })
            return
        }

        this.loading = true

        try {
            const { keyEntry, account } = this
            const wallet = account!.tonWallet.contractType
            const keyPassword = prepareKey({ keyEntry, password, cache, wallet })
            const isValid = ignoreCheckPassword(keyPassword) || await this.rpcStore.rpc.checkPassword(keyPassword)

            if (isValid) {
                await this.approvalStore.resolvePendingApproval(keyPassword, true)
                runInAction(() => {
                    this.submitted = true
                })
            }
            else {
                runInAction(() => {
                    this.error = this.localization.intl.formatMessage({ id: 'ERROR_INVALID_PASSWORD' })
                })
            }
        }
        catch (e: any) {
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

}
