import React from 'react'
import { useIntl } from 'react-intl'
import classNames from 'classnames'

import Button from '../../../../modules/shared/components/Button'
import { Select } from '@app/popup/components/Select'
import { AddAccountFlow } from '@app/popup/components/AccountsManagement/components'
import { useAccountability } from '@app/popup/modules/shared/providers/AccountabilityProvider'

const CreateAccountIcon = ({ className }: { className?: string }) => {
    return (
        <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M19.9122 0L11 8.91221V13H15.0878L24 4.08779L19.9122 0ZM14.319 11.4H12.6V9.68097L19.8809 2.40002L21.6 4.11907L14.319 11.4ZM4 5H3V6V20V21H4H18H19V20V15H17V19H5V7H9V5H4Z"
                fill="currentColor"
            />
        </svg>
    )
}

const PlusIcon = ({ className }: { className?: string }) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            className={className}
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M10 0H8V8H0V10H8V18H10V10H18V8H10V0Z"
                fill="currentColor"
            />
        </svg>
    )
}

type Props = {
    flow: AddAccountFlow
    onSelect(flow: AddAccountFlow): void
    onNext(): void
    onBack?(): void
}

export function SelectAccountAddingFlow({ flow, onSelect, onNext, onBack }: Props): JSX.Element {
    const intl = useIntl()
    const accountability = useAccountability()

    const derivedKeys = React.useMemo(
        () =>
            accountability.derivedKeys.sort(
                (a, b) => a.accountId - b.accountId
            ) /*.map((key) => ({ label: key.name, value: key }))*/,
        [accountability.derivedKeys]
    )

    const derivedKeysOptions = React.useMemo(
        () =>
            derivedKeys.map((key) => ({
                label: key.name,
                value: key.publicKey,
                ...key,
            })),
        [derivedKeys]
    )

    const onChangeDerivedKey = (value: string, option: any) => {
        if (value != null) {
            accountability.setCurrentDerivedKey(option)
        }
    }

    const onChangeFlow = (flow: AddAccountFlow) => {
        return () => {
            onSelect(flow)
        }
    }

    return (
        <div className="accounts-management">
            <header className="accounts-management__header">
                <h2 className="accounts-management__header-title">
                    {intl.formatMessage({ id: 'ADD_ACCOUNT_PANEL_HEADER' })}
                </h2>
            </header>

            <div className="accounts-management__wrapper">
                <div className="accounts-management__content">
                    <div className="accounts-management__content-form-rows">
                        <div className="accounts-management__content-form-row">
                            <Select
                                options={derivedKeysOptions}
                                value={
                                    accountability.currentDerivedKey?.publicKey ||
                                    accountability.derivedKeys[0]?.publicKey
                                }
                                getPopupContainer={(trigger) =>
                                    trigger.closest('.sliding-panel__content') ||
                                    document.getElementById('root') ||
                                    document.body
                                }
                                onChange={onChangeDerivedKey}
                            />
                        </div>
                    </div>

                    <div className="accounts-management__add-options">
                        <div
                            className={classNames('accounts-management__add-options-option', {
                                'accounts-management__add-options-option-selected':
                                    flow === AddAccountFlow.CREATE,
                            })}
                            onClick={onChangeFlow(AddAccountFlow.CREATE)}
                        >
                            <CreateAccountIcon className="accounts-management__add-options-icon" />
                            {intl.formatMessage({ id: 'ADD_ACCOUNT_PANEL_FLOW_CREATE_LABEL' })}
                        </div>
                        <div
                            className={classNames('accounts-management__add-options-option', {
                                'accounts-management__add-options-option-selected':
                                    flow === AddAccountFlow.IMPORT,
                            })}
                            onClick={onChangeFlow(AddAccountFlow.IMPORT)}
                        >
                            <PlusIcon className="accounts-management__add-options-icon" />
                            {intl.formatMessage({
                                id: 'ADD_ACCOUNT_PANEL_FLOW_CREATE_AN_EXISTING_LABEL',
                            })}
                        </div>
                    </div>
                </div>

                <footer className="accounts-management__footer">
                    {typeof onBack === 'function' && (
                        <div className="accounts-management__footer-button-back">
                            <Button
                                text={intl.formatMessage({ id: 'BACK_BTN_TEXT' })}
                                design="secondary"
                                onClick={onBack}
                            />
                        </div>
                    )}
                    <Button text={intl.formatMessage({ id: 'NEXT_BTN_TEXT' })} onClick={onNext} />
                </footer>
            </div>
        </div>
    )
}
