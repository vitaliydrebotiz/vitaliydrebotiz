import { makeAutoObservable, runInAction } from 'mobx'
import { injectable } from 'tsyringe'

import { AccountabilityStore, createEnumField, LocalizationStore, RpcStore } from '@app/popup/modules/shared'
import { parseError } from '@app/popup/utils'

@injectable()
export class OnboardingPageViewModel {

    public step = createEnumField<typeof Step>(Step.Welcome)

    public restoreInProcess = false

    public restoreError: any = null

    constructor(
        private rpcStore: RpcStore,
        private accountability: AccountabilityStore,
        private localization: LocalizationStore,
    ) {
        makeAutoObservable(this, undefined, { autoBind: true })
    }

    public get selectedLocale(): string {
        return this.rpcStore.state.selectedLocale
    }

    public get selectedMasterKey(): string | undefined {
        return this.accountability.selectedMasterKey
    }

    public setLocale(locale: string): Promise<void> {
        return this.localization.setLocale(locale)
    }

    public async restoreFromBackup(): Promise<void> {
        if (this.restoreInProcess) return

        this.restoreInProcess = true

        try {
            const file = await this.updateFile()
            const storage = file ? await this.readFile(file) : null
            const result = storage ? await this.rpcStore.rpc.importStorage(storage) : false

            if (!file || !storage) {
                return
            }

            if (!result) {
                throw new Error('Failed to import storage')
            }

            this.step.setValue(Step.Final)
        }
        catch (e) {
            runInAction(() => {
                this.restoreError = parseError(e)
            })
        }
        finally {
            runInAction(() => {
                this.restoreInProcess = false
            })
        }
    }

    public close(): void {
        window.close()
    }

    private readFile(file: File): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = event => {
                resolve(event.target?.result as string)
            }
            reader.onerror = _error => {
                reject(reader.error)
            }
            reader.readAsText(file)
        })
    }

    private updateFile(): Promise<File | undefined> {
        let lock = false
        return new Promise<File | undefined>(resolve => {
            // create input file
            const input = document.createElement('input')
            input.id = (+new Date()).toString()
            input.style.display = 'none'
            input.setAttribute('type', 'file')
            input.accept = '.json'
            document.body.appendChild(input)

            input.addEventListener(
                'change',
                () => {
                    lock = true
                    const file = input.files?.[0]
                    resolve(file)
                    // remove dom
                    const fileInput = document.getElementById(input.id)
                    fileInput?.remove()
                },
                { once: true },
            )

            // file blur
            window.addEventListener(
                'focus',
                () => {
                    setTimeout(() => {
                        if (!lock && document.getElementById(input.id)) {
                            resolve(undefined)
                            // remove dom
                            const fileInput = document.getElementById(input.id)
                            fileInput?.remove()
                        }
                    }, 300)
                },
                { once: true },
            )

            // open file select box
            input.click()
        })
    }

}

export enum Step {
    Welcome,
    CreateAccount,
    ImportAccount,
    LedgerAccount,
    Final,
}
