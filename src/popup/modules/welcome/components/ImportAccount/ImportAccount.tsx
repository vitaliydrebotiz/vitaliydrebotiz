import { observer } from 'mobx-react-lite'
import { useCallback } from 'react'
import { useIntl } from 'react-intl'

import { ErrorMessage, Notification, useViewModel } from '@app/popup/modules/shared'

import { EnterSeed } from '../EnterSeed'
import { NewPassword } from '../NewPassword'
import { ImportAccountViewModel, Step } from './ImportAccountViewModel'

interface Props {
    name: string;
    onBack: () => void;
}

export const ImportAccount = observer(({ name, onBack }: Props): JSX.Element => {
    const vm = useViewModel(ImportAccountViewModel)
    const intl = useIntl()

    const submit = useCallback((pwd: string) => vm.submit(name, pwd), [name])

    return (
        <>
            {vm.step.is(Step.EnterPhrase) && (
                <EnterSeed
                    disabled={vm.loading}
                    getBip39Hints={vm.getBip39Hints}
                    onSubmit={vm.submitSeed}
                    onBack={onBack}
                />
            )}
            {vm.step.is(Step.EnterPassword) && (
                <NewPassword
                    disabled={vm.loading}
                    onSubmit={submit}
                    onBack={vm.step.callback(Step.EnterPhrase)}
                />
            )}
            <Notification
                opened={!!vm.error}
                title={intl.formatMessage({ id: 'COULD_NOT_IMPORT_WALLET' })}
                onClose={vm.resetError}
            >
                <ErrorMessage>{vm.error}</ErrorMessage>
            </Notification>
        </>
    )
})
