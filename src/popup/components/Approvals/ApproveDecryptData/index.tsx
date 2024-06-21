import React from 'react'
import { useIntl } from 'react-intl'
import { parseError, prepareKey } from '@app/popup/utils'
import { PendingApproval } from '@shared/backgroundApi'
import * as nt from '@nekoton'

import Button from '../../../modules/shared/components/Button'
import Approval from '../Approval'
import { EnterPassword } from '@app/popup/components/EnterPassword'
import SlidingPanel from '@app/popup/components/SlidingPanel'

import './style.scss'

type Props = {
    approval: PendingApproval<'decryptData'>
    accountEntries: { [address: string]: nt.AssetsList }
    storedKeys: { [publicKey: string]: nt.KeyStoreEntry }
    checkPassword: (password: nt.KeyPassword) => Promise<boolean>
    onSubmit: (password: nt.KeyPassword, delayedDeletion: boolean) => void
    onReject: () => void
}

export function ApproveDecryptData({
    approval,
    accountEntries,
    storedKeys,
    checkPassword,
    onSubmit,
    onReject,
}: Props) {
    const intl = useIntl()
    const { origin } = approval
    const { publicKey, sourcePublicKey } = approval.requestData

    const [inProcess, setInProcess] = React.useState(false)
    const [error, setError] = React.useState<string>()
    const [passwordModalVisible, setPasswordModalVisible] = React.useState(false)

    const keyEntry = storedKeys[publicKey]

    const account = window.ObjectExt.values(accountEntries).find(
        (account) => account.tonWallet.publicKey == publicKey
    )
    if (account == null) {
        !inProcess && onReject()
        setInProcess(true)
        return null
    }

    const trySubmit = async (password: string) => {
        if (keyEntry == null) {
            setError(intl.formatMessage({ id: 'ERROR_KEY_ENTRY_NOT_FOUND' }))
            return
        }

        setInProcess(true)
        try {
            const keyPassword = prepareKey(keyEntry, password)
            const isValid = await checkPassword(keyPassword)
            if (isValid) {
                onSubmit(keyPassword, true)
            } else {
                setError(intl.formatMessage({ id: 'ERROR_INVALID_PASSWORD' }))
            }
        } catch (e: any) {
            setError(parseError(e))
        } finally {
            setInProcess(false)
        }
    }

    return (
        <>
            <Approval
                account={account}
                title={intl.formatMessage({ id: 'APPROVE_DECRYPT_DATA_APPROVAL_TITLE' })}
                origin={origin}
                className={'approval--encrypt-data'}
            >
                <div className="approval__wrapper">
                    <div className="approval__spend-details">
                        <div className="approval__spend-details-param">
                            <span className="approval__spend-details-param-desc">
                                {intl.formatMessage({ id: 'APPROVE_DECRYPT_DATA_TERM_PUBLIC_KEY' })}
                            </span>
                            <span className="approval__spend-details-param-value">
                                {sourcePublicKey}
                            </span>
                        </div>
                    </div>

                    <footer className="approval__footer">
                        <Button
                            type="button"
                            design="secondary"
                            text={intl.formatMessage({ id: 'REJECT_BTN_TEXT' })}
                            onClick={onReject}
                        />
                        <Button
                            type="submit"
                            text={intl.formatMessage({ id: 'DECRYPT_BTN_TEXT' })}
                            onClick={() => {
                                setPasswordModalVisible(true)
                            }}
                        />
                    </footer>
                </div>
            </Approval>
            <SlidingPanel
                isOpen={passwordModalVisible}
                onClose={() => setPasswordModalVisible(false)}
            >
                <EnterPassword
                    keyEntry={keyEntry}
                    disabled={inProcess}
                    error={error}
                    handleNext={trySubmit}
                    handleBack={() => setPasswordModalVisible(false)}
                />
            </SlidingPanel>
        </>
    )
}
