import { memo } from 'react'

import Arrow from '@app/popup/assets/img/arrow.svg'
import { AssetIcon, UsdtPrice } from '@app/popup/modules/shared'
import { AssetType, convertCurrency } from '@app/shared'

import './AssetListItem.scss'

interface Props {
    type: AssetType;
    address: string;
    balance?: string;
    currencyName?: string;
    decimals?: number;
    old?: boolean;
    onClick: () => void;
}

export const AssetListItem = memo((props: Props): JSX.Element => {
    const { type, address, balance, currencyName, decimals, old, onClick } = props
    const amount = decimals != null ? convertCurrency(balance || '0', decimals) : ''

    return (
        <div
            className="assets-list-item" role="menuitem" tabIndex={0}
            onClick={onClick}
        >
            <AssetIcon
                className="assets-list-item__logo"
                type={type}
                address={address}
                old={old}
            />
            <div className="assets-list-item__balance">
                <p className="assets-list-item__balance-amount" title={`${amount} ${currencyName}`}>
                    {amount}&nbsp;{currencyName}
                </p>
                <p className="assets-list-item__balance-dollars">
                    <UsdtPrice amount={balance ?? '0'} tokenRoot={type === 'token_wallet' ? address : undefined} />
                </p>
            </div>
            <img className="assets-list-item__arrow" src={Arrow} alt="" />
        </div>
    )
})
