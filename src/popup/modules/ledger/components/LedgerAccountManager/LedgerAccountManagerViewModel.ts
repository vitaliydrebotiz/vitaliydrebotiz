import { makeAutoObservable } from 'mobx'
import { injectable } from 'tsyringe'

import { Logger } from '@app/shared'
import { createEnumField, RpcStore } from '@app/popup/modules/shared'

@injectable()
export class LedgerAccountManagerViewModel {

    public name: string | undefined

    public onBack!: () => void

    public step = createEnumField<typeof Step>(Step.Select)

    constructor(
        private rpcStore: RpcStore,
        private logger: Logger,
    ) {
        makeAutoObservable<LedgerAccountManagerViewModel, any>(this, {
            rpcStore: false,
            logger: false,
        }, { autoBind: true })
    }

    public async onSuccess(): Promise<void> {
        try {
            if (this.name) {
                const masterKey = await this.rpcStore.rpc.getLedgerMasterKey()
                await this.rpcStore.rpc.updateMasterKeyName(masterKey, this.name)
            }

            this.onBack()
        }
        catch (e) {
            this.step.setValue(Step.Connect)
            this.logger.error(e)
        }
    }

}

export enum Step {
    Connect,
    Select,
}
