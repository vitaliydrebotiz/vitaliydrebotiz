import React from 'react'
import { useIntl } from 'react-intl'

import * as nt from '@nekoton'
import {
    CheckNewSeedPhrase,
    EnterNewSeedPasswords,
    ImportSeed,
    NewSeedPhrase,
} from '@app/popup/components/AccountsManagement/components'
import Button from '../../../../modules/shared/components/Button'
import Input from '@app/popup/components/Input'
import { Select } from '@app/popup/components/Select'
import { Step, useAccountability } from '@app/popup/modules/shared/providers/AccountabilityProvider'
import { generateSeed, validateMnemonic } from '@app/popup/modules/shared/store/app/actions'
import { useRpc } from '@app/popup/modules/shared/providers/RpcProvider'
import { parseError } from '@app/popup/utils'
import { useRpcState } from '@app/popup/modules/shared/providers/RpcStateProvider'
import AccountManager from '@app/popup/components/Ledger/AccountManager'

enum AddSeedFlow {
    CREATE,
    IMPORT,
    IMPORT_LEGACY,
    CONNECT_LEDGER,
}

enum FlowStep {
    INDEX,
    SHOW_PHRASE,
    CHECK_PHRASE,
    PASSWORD_REQUEST,
    IMPORT_PHRASE,
    CONNECT_LEDGER,
}

type OptionType = {
    key: AddSeedFlow
    value: AddSeedFlow
    label: string
}

export function CreateSeed(): JSX.Element {
    const intl = useIntl()
    const accountability = useAccountability()
    const rpc = useRpc()
    const rpcState = useRpcState()

    const flowOptions = React.useMemo<OptionType[]>(
        () => [
            {
                key: AddSeedFlow.CREATE,
                label: intl.formatMessage({ id: 'ADD_SEED_OPTION_CREATE' }),
                value: AddSeedFlow.CREATE,
            },
            {
                key: AddSeedFlow.IMPORT,
                label: intl.formatMessage({ id: 'ADD_SEED_OPTION_IMPORT' }),
                value: AddSeedFlow.IMPORT,
            },
            {
                key: AddSeedFlow.IMPORT_LEGACY,
                label: intl.formatMessage({ id: 'ADD_SEED_OPTION_IMPORT_LEGACY' }),
                value: AddSeedFlow.IMPORT_LEGACY,
            },
            {
                key: AddSeedFlow.CONNECT_LEDGER,
                label: intl.formatMessage({ id: 'ADD_SEED_OPTION_CONNECT_LEDGER' }),
                value: AddSeedFlow.CONNECT_LEDGER,
            },
        ],
        []
    )

    const [error, setError] = React.useState<string>()
    const [flow, setFlow] = React.useState<AddSeedFlow | undefined>(flowOptions[0].value)
    const [inProcess, setInProcess] = React.useState(false)
    const [name, setName] = React.useState<string>()
    const [seed, setSeed] = React.useState(generateSeed())
    const [step, setStep] = React.useState<FlowStep>(FlowStep.INDEX)

    const seedWords = React.useMemo(() => seed.phrase.split(' '), [seed])

    const onChangeFlow = (value: AddSeedFlow | undefined) => {
        setFlow(value)
    }

    const onSubmit = async (password: string) => {
        setInProcess(true)

        try {
            let nameToSave = name?.trim()
            if (nameToSave?.length === 0) {
                nameToSave = undefined
            }

            const entry = await rpc.createMasterKey({
                select: false,
                name: nameToSave,
                password,
                seed,
            })

            if (entry != null) {
                accountability.onManageMasterKey(entry)
                accountability.onManageDerivedKey(entry)
            }
        } catch (e: any) {
            setError(parseError(e))
            setInProcess(false)
        } finally {
            setInProcess(false)
        }
    }

    const onNext = () => {
        switch (step) {
            case FlowStep.SHOW_PHRASE:
                setStep(FlowStep.CHECK_PHRASE)
                break

            case FlowStep.CHECK_PHRASE:
                setStep(FlowStep.PASSWORD_REQUEST)
                break

            default:
                if (flow === AddSeedFlow.CREATE) {
                    setStep(FlowStep.SHOW_PHRASE)
                } else if (flow === AddSeedFlow.IMPORT || flow === AddSeedFlow.IMPORT_LEGACY) {
                    setStep(FlowStep.IMPORT_PHRASE)
                } else if (flow === AddSeedFlow.CONNECT_LEDGER) {
                    setStep(FlowStep.CONNECT_LEDGER)
                }
        }
    }

    const onNextWhenImport = (words: string[]) => {
        const phrase = words.join(' ')
        const mnemonicType: nt.MnemonicType =
            flow === AddSeedFlow.IMPORT_LEGACY ? { type: 'legacy' } : { type: 'labs', accountId: 0 }

        try {
            validateMnemonic(phrase, mnemonicType)
            setSeed({ phrase, mnemonicType })
            setStep(FlowStep.PASSWORD_REQUEST)
        } catch (e: any) {
            setError(parseError(e))
        }
    }

    const onBack = () => {
        setError(undefined)

        switch (step) {
            case FlowStep.SHOW_PHRASE:
            case FlowStep.IMPORT_PHRASE:
                setStep(FlowStep.INDEX)
                break

            case FlowStep.CHECK_PHRASE:
                setStep(FlowStep.SHOW_PHRASE)
                break

            case FlowStep.PASSWORD_REQUEST:
                if (flow === AddSeedFlow.CREATE) {
                    setStep(FlowStep.SHOW_PHRASE)
                } else if (flow === AddSeedFlow.IMPORT || flow === AddSeedFlow.IMPORT_LEGACY) {
                    setStep(FlowStep.IMPORT_PHRASE)
                } else if (flow === AddSeedFlow.CONNECT_LEDGER) {
                    setStep(FlowStep.CONNECT_LEDGER)
                }
                break

            default:
                accountability.setStep(Step.MANAGE_SEEDS)
        }
    }

    return (
        <>
            {step === FlowStep.INDEX && (
                <div key="index" className="accounts-management">
                    <header className="accounts-management__header">
                        <h2 className="accounts-management__header-title">
                            {intl.formatMessage({ id: 'ADD_SEED_PANEL_HEADER' })}
                        </h2>
                    </header>

                    <div className="accounts-management__wrapper">
                        <div className="accounts-management__content-form-rows">
                            <div className="accounts-management__content-form-row">
                                <Input
                                    placeholder={intl.formatMessage({
                                        id: 'ENTER_SEED_FIELD_PLACEHOLDER',
                                    })}
                                    type="text"
                                    autoComplete="off"
                                    value={name || ''}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>

                            <div className="accounts-management__content-form-row">
                                <Select<AddSeedFlow>
                                    options={flowOptions}
                                    value={flow}
                                    onChange={onChangeFlow}
                                />
                            </div>
                        </div>

                        <footer className="accounts-management__footer">
                            <div className="accounts-management__footer-button-back">
                                <Button
                                    text={intl.formatMessage({ id: 'BACK_BTN_TEXT' })}
                                    disabled={inProcess}
                                    design="secondary"
                                    onClick={onBack}
                                />
                            </div>
                            <Button
                                text={intl.formatMessage({ id: 'NEXT_BTN_TEXT' })}
                                type="submit"
                                onClick={onNext}
                            />
                        </footer>
                    </div>
                </div>
            )}

            {step === FlowStep.SHOW_PHRASE && (
                <NewSeedPhrase
                    key="exportedSeed"
                    seedWords={seedWords}
                    onNext={onNext}
                    onBack={onBack}
                />
            )}

            {step === FlowStep.CHECK_PHRASE && (
                <CheckNewSeedPhrase
                    key="checkSeed"
                    seedWords={seedWords}
                    onSubmit={onNext}
                    onBack={onBack}
                />
            )}

            {step === FlowStep.PASSWORD_REQUEST && (
                <EnterNewSeedPasswords
                    key="passwordRequest"
                    disabled={inProcess}
                    error={error}
                    onSubmit={onSubmit}
                    onBack={onBack}
                />
            )}

            {step === FlowStep.IMPORT_PHRASE && (
                <ImportSeed
                    key="importSeed"
                    wordsCount={flow === AddSeedFlow.IMPORT_LEGACY ? 24 : 12}
                    error={error}
                    onSubmit={onNextWhenImport}
                    onBack={onBack}
                />
            )}

            {step === FlowStep.CONNECT_LEDGER && <AccountManager name={name} onBack={onBack} />}
        </>
    )
}
