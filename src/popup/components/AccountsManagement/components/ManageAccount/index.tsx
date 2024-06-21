import React from 'react'
import classNames from 'classnames'
import QRCode from 'react-qr-code'
import { useIntl } from 'react-intl'

import * as nt from '@nekoton'
import Button from '../../../../modules/shared/components/Button'
import { CopyText } from '@app/popup/components/CopyText'
import Input from '@app/popup/components/Input'
import { Switcher } from '@app/popup/components/Switcher'
import { Step, useAccountability } from '@app/popup/modules/shared/providers/AccountabilityProvider'
import { useDrawerPanel } from '@app/popup/modules/shared/providers/DrawerPanelProvider'
import { useRpc } from '@app/popup/modules/shared/providers/RpcProvider'
import { closeCurrentWindow, useRpcState } from '@app/popup/modules/shared/providers/RpcStateProvider'

import Arrow from '@app/popup/assets/img/arrow.svg'
import TonKey from '@app/popup/assets/img/ton-key.svg'

export function ManageAccount(): JSX.Element {
    const intl = useIntl()
    const accountability = useAccountability()
    const rpc = useRpc()
    const rpcState = useRpcState()

    const [name, setName] = React.useState(accountability.currentAccount?.name || '')

    const isVisible = React.useMemo(() => {
        if (accountability.currentAccount) {
            return accountability.accountsVisibility[
                accountability.currentAccount.tonWallet.address
            ]
        }
        return false
    }, [accountability.accountsVisibility])

    const isActive = React.useMemo(
        () =>
            accountability.currentAccount?.tonWallet.address ===
            accountability.selectedAccount?.tonWallet.address,
        [
            accountability.currentAccount?.tonWallet.address,
            accountability.selectedAccount?.tonWallet.address,
        ]
    )

    const linkedKeys = React.useMemo(() => {
        const keys = window.ObjectExt.values({ ...rpcState.state.storedKeys }).filter(
            (key) => key.publicKey === accountability.currentAccount?.tonWallet.publicKey
        )

        const externalAccount = rpcState.state.externalAccounts.find(
            ({ address }) => address === accountability.currentAccount?.tonWallet.address
        )

        if (externalAccount !== undefined) {
            keys.push(
                ...externalAccount.externalIn
                    .map((key) => rpcState.state.storedKeys[key])
                    .filter((e) => e)
            )
        }

        return keys
    }, [rpcState.state.storedKeys])

    const saveName = async () => {
        if (accountability.currentAccount !== undefined && name) {
            await rpc.renameAccount(accountability.currentAccount.tonWallet.address, name)
            accountability.setCurrentAccount({ ...accountability.currentAccount, name })
        }
    }

    const onSelectAccount = async () => {
        if (accountability.currentMasterKey?.masterKey == null) {
            return
        }

        await rpc.selectMasterKey(accountability.currentMasterKey.masterKey)
        if (accountability.currentAccount == null) {
            return
        }

        await rpc.updateAccountVisibility(accountability.currentAccount.tonWallet.address, true)
        await rpc.selectAccount(accountability.currentAccount.tonWallet.address)

        accountability.reset()

        if (rpcState.activeTab?.type === 'notification') {
            closeCurrentWindow()
        }
    }

    const onManageDerivedKey = (key: nt.KeyStoreEntry) => {
        return () => accountability.onManageDerivedKey(key)
    }

    const onToggleVisibility = async () => {
        if (accountability.currentAccount && !isActive) {
            await rpc.updateAccountVisibility(
                accountability.currentAccount.tonWallet.address,
                !isVisible
            )
        }
    }

    const onBack = () => {
        accountability.setStep(Step.MANAGE_DERIVED_KEY)
        accountability.setCurrentAccount(undefined)
    }

    return (
        <div className="accounts-management">
            <header className="accounts-management__header">
                <h2 className="accounts-management__header-title">
                    {intl.formatMessage({ id: 'MANAGE_ACCOUNT_PANEL_HEADER' })}
                </h2>
            </header>

            <div className="accounts-management__wrapper">
                <div className="accounts-management__content">
                    <div className="accounts-management__content-header">
                        {intl.formatMessage({ id: 'MANAGE_ACCOUNT_FIELD_NAME_LABEL' })}
                    </div>
                    <div className="accounts-management__name-field">
                        <Input
                            name="seed_name"
                            placeholder={intl.formatMessage({
                                id: 'ENTER_ACCOUNT_NAME_FIELD_PLACEHOLDER',
                            })}
                            type="text"
                            autoComplete="off"
                            value={name || ''}
                            onChange={(e) => setName(e.target.value)}
                        />

                        {accountability.currentAccount !== undefined &&
                            (accountability.currentAccount.name !== undefined || name) &&
                            accountability.currentAccount.name !== name && (
                                <a
                                    role="button"
                                    className="accounts-management__name-button"
                                    onClick={saveName}
                                >
                                    {intl.formatMessage({ id: 'SAVE_BTN_TEXT' })}
                                </a>
                            )}
                    </div>

                    <div
                        className={classNames('accounts-management__account-visibility', {
                            'accounts-management__account-visibility-disabled': isActive,
                        })}
                    >
                        <Switcher
                            id="visibility"
                            checked={isVisible}
                            onChange={onToggleVisibility}
                        />
                        <label htmlFor="visibility">
                            {intl.formatMessage({ id: 'MANAGE_ACCOUNT_VISIBILITY_SWITCHER_LABEL' })}
                        </label>
                    </div>

                    {accountability.currentAccount !== undefined && (
                        <div className="accounts-management__address-placeholder">
                            <div className="accounts-management__address-qr-code">
                                <QRCode
                                    value={`ton://chat/${accountability.currentAccount.tonWallet.address}`}
                                    size={80}
                                />
                            </div>
                            <div>
                                <div className="accounts-management__address-text">
                                    <CopyText
                                        text={accountability.currentAccount.tonWallet.address}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {linkedKeys.length > 0 && (
                        <>
                            <div className="accounts-management__content-header">
                                {intl.formatMessage({
                                    id: 'MANAGE_ACCOUNT_LIST_LINKED_KEYS_HEADING',
                                })}
                            </div>
                            <div className="accounts-management__divider" />
                            <ul className="accounts-management__list">
                                {linkedKeys.map((key) => (
                                    <li key={key.publicKey}>
                                        <div
                                            role="button"
                                            className="accounts-management__list-item"
                                            onClick={onManageDerivedKey(key)}
                                        >
                                            <img
                                                src={TonKey}
                                                alt=""
                                                className="accounts-management__list-item-logo"
                                            />
                                            <div className="accounts-management__list-item-title">
                                                {key.name}
                                            </div>
                                            <img
                                                src={Arrow}
                                                alt=""
                                                style={{ height: 24, width: 24 }}
                                            />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>

                <footer className="accounts-management__footer">
                    <div className="accounts-management__footer-button-back">
                        <Button
                            text={intl.formatMessage({ id: 'BACK_BTN_TEXT' })}
                            design="secondary"
                            onClick={onBack}
                        />
                    </div>
                    <Button
                        text={intl.formatMessage({ id: 'MANAGE_ACCOUNT_GO_TO_ACCOUNT_BTN_TEXT' })}
                        onClick={onSelectAccount}
                    />
                </footer>
            </div>
        </div>
    )
}
