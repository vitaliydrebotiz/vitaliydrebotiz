import React from 'react'
import { useIntl } from 'react-intl'
import classNames from 'classnames'

import * as nt from '@nekoton'
import { TransactionsList } from '@app/popup/components/TransactionsList'
import { AssetsList } from '@app/popup/components/UserAssets/components'
import { useAccountability } from '@app/popup/modules/shared/providers/AccountabilityProvider'
import { useRpcState } from '@app/popup/modules/shared/providers/RpcStateProvider'

import { StoredBriefMessageInfo, TokenWalletsToUpdate } from '@shared/backgroundApi'
import { SelectedAsset, TokenWalletState } from '@shared/utils'

import './style.scss'

enum AssetsTab {
    ASSETS,
    TRANSACTIONS,
}

type Props = {
    tonWalletAsset: nt.TonWalletAsset
    tokenWalletAssets: nt.TokenWalletAsset[]
    tonWalletState: nt.ContractState | undefined
    tokenWalletStates: { [rootTokenContract: string]: TokenWalletState }
    knownTokens: { [rootTokenContract: string]: nt.Symbol }
    transactions: nt.Transaction[]
    scrollArea: React.RefObject<HTMLDivElement>
    onViewTransaction: (transaction: nt.Transaction) => void
    updateTokenWallets: (params: TokenWalletsToUpdate) => Promise<void>
    onViewAsset: (asset: SelectedAsset) => void
    preloadTransactions: (continuation: nt.TransactionId) => Promise<void>
}

export function UserAssets({
    tonWalletAsset,
    tokenWalletAssets,
    tonWalletState,
    tokenWalletStates,
    knownTokens,
    transactions,
    scrollArea,
    updateTokenWallets,
    onViewTransaction,
    onViewAsset,
    preloadTransactions,
}: Props): JSX.Element {
    const intl = useIntl()
    const accountability = useAccountability()
    const rpcState = useRpcState()

    const [activeTab, setActiveTab] = React.useState<AssetsTab>(AssetsTab.ASSETS)

    const pendingTransactions = React.useMemo(() => {
        const values: StoredBriefMessageInfo[] = []

        if (accountability.selectedAccountAddress == null) {
            return values
        }

        window.ObjectExt.values({
            ...rpcState.state.accountPendingTransactions[accountability.selectedAccountAddress],
        }).forEach((entry) => {
            values.push(entry)
        })

        return values.sort((a, b) => b.createdAt - a.createdAt)
    }, [accountability.selectedAccountAddress, rpcState.state.accountPendingTransactions])

    return (
        <>
            <div className="user-assets">
                <div className="user-assets__panel noselect">
                    <div
                        className={classNames('user-assets__panel__tab', {
                            _active: activeTab == AssetsTab.ASSETS,
                        })}
                        onClick={() => setActiveTab(AssetsTab.ASSETS)}
                    >
                        {intl.formatMessage({ id: 'USER_ASSETS_TAB_ASSETS_LABEL' })}
                    </div>
                    <div
                        className={classNames('user-assets__panel__tab', {
                            _active: activeTab == AssetsTab.TRANSACTIONS,
                        })}
                        onClick={() => setActiveTab(AssetsTab.TRANSACTIONS)}
                    >
                        {intl.formatMessage({ id: 'USER_ASSETS_TAB_TRANSACTIONS_LABEL' })}
                    </div>
                </div>
                {activeTab == AssetsTab.ASSETS && (
                    <AssetsList
                        tonWalletAsset={tonWalletAsset}
                        tokenWalletAssets={tokenWalletAssets}
                        tonWalletState={tonWalletState}
                        onViewAsset={onViewAsset}
                        knownTokens={knownTokens}
                        tokenWalletStates={tokenWalletStates}
                        updateTokenWallets={updateTokenWallets}
                    />
                )}
                {activeTab == AssetsTab.TRANSACTIONS && (
                    <TransactionsList
                        tonWalletAsset={tonWalletAsset}
                        topOffset={397 + 54}
                        fullHeight={600}
                        scrollArea={scrollArea}
                        transactions={transactions}
                        pendingTransactions={pendingTransactions}
                        onViewTransaction={onViewTransaction}
                        preloadTransactions={preloadTransactions}
                    />
                )}
            </div>
        </>
    )
}
