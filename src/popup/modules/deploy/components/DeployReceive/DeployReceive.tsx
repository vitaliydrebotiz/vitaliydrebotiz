import { memo } from 'react'
import { useIntl } from 'react-intl'
import QRCode from 'react-qr-code'

import { convertEvers } from '@app/shared'
import { Button, Content, CopyButton, CopyText, Footer } from '@app/popup/modules/shared'

import './DeployReceive.scss'

interface Props {
    address: string;
    totalAmount: string;
    currencyName: string;
}

export const DeployReceive = memo(({ address, totalAmount, currencyName }: Props): JSX.Element => {
    const intl = useIntl()

    return (
        <>
            <Content className="deploy-receive">
                <p className="deploy-receive__comment">
                    {intl.formatMessage(
                        { id: 'DEPLOY_WALLET_DRAWER_INSUFFICIENT_BALANCE_HINT' },
                        {
                            value: convertEvers(totalAmount),
                            symbol: currencyName,
                        },
                    )}
                </p>

                <h3 className="deploy-receive__header">
                    {intl.formatMessage(
                        { id: 'DEPLOY_WALLET_DRAWER_ADDRESS_COPY_HEADING' },
                        { symbol: currencyName },
                    )}
                </h3>

                <div className="deploy-receive__qr-code">
                    <div className="deploy-receive__qr-code-code">
                        <QRCode value={`ton://chat/${address}`} size={80} />
                    </div>
                    <div className="deploy-receive__qr-code-address">
                        <CopyText text={address} />
                    </div>
                </div>
            </Content>

            <Footer>
                <CopyButton text={address}>
                    <Button>
                        {intl.formatMessage({ id: 'COPY_ADDRESS_BTN_TEXT' })}
                    </Button>
                </CopyButton>
            </Footer>
        </>
    )
})
