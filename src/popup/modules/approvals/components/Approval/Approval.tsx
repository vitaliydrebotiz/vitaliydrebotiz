import type nt from '@broxus/ever-wallet-wasm'
import classNames from 'classnames'
import { memo, PropsWithChildren } from 'react'

import { Container, UserInfo } from '@app/popup/modules/shared'

import { WebsiteIcon } from '../WebsiteIcon'

import './Approval.scss'

type Props = PropsWithChildren<{
    title: string
    origin: string
    networkName: string
    account: nt.AssetsList
    className?: string
}>;

export const Approval = memo(({ title, origin, account, networkName, className, children }: Props): JSX.Element => (
    <Container className={classNames('approval', className)}>
        <div className="approval__top-panel">
            <div className="approval__top-panel-network">
                <UserInfo className="approval__user-info" account={account} />
                <div className="approval__network">
                    {networkName}
                </div>
            </div>
            <div className="approval__top-panel-site">
                <WebsiteIcon />
                <div className="approval__address-entry">{origin}</div>
            </div>
            <h3 className="approval__top-panel-header noselect">{title}</h3>
        </div>
        {children}
    </Container>
))
