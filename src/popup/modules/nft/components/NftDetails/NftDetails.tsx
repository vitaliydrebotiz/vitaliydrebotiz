import { observer } from 'mobx-react-lite'
import { useIntl } from 'react-intl'

import { Nft } from '@app/models'
import { convertAddress } from '@app/shared'
import { Button, ButtonGroup, Container, Content, Footer, Header, useViewModel } from '@app/popup/modules/shared'
import ExternalIcon from '@app/popup/assets/icons/external.svg'

import { NftDetailsViewModel } from './NftDetailsViewModel'

import './NftDetails.scss'
import EvernameBg from '@app/popup/assets/img/evername-bg.svg'

interface Props {
    nft: Nft;
}

export const NftDetails = observer(({ nft }: Props): JSX.Element => {
    const vm = useViewModel(NftDetailsViewModel, (model) => {
        model.nft = nft
    })
    const intl = useIntl()

    return (
        <Container className="nft-details">
            <Header>
                <h2 className="nft-details__header">{vm.nft.name}</h2>
            </Header>

            <Content className="nft-details__content">
                {!vm.canTransfer && (
                    <div className="nft-details__hint">
                        {intl.formatMessage({ id: 'NFT_DETAILS_HINT' })}
                    </div>
                )}
                {vm.isEvername && !vm.nft.img && (
                    <div className="nft-details__img">
                        <img
                            src={EvernameBg}
                            alt=""
                        />
                        <div className="nft-details__img-label">
                            {vm.nft.name.replace(/\.ever$/i, '')}
                        </div>
                    </div>
                )}
                {vm.nft.img && (
                    <div className="nft-details__img">
                        <img
                            src={vm.nft.img}
                            alt={vm.nft.name}
                            onError={onError}
                        />
                    </div>
                )}
                <div className="nft-details__info">
                    <div className="nft-details__info-row">
                        <div className="nft-details__info-label">
                            Contract
                        </div>
                        <a
                            className="nft-details__info-value"
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            href={vm.getExplorerLink(vm.nft.address)}
                        >
                            {convertAddress(vm.nft.address)}
                            <ExternalIcon className="nft-details__info-value-icon" />
                        </a>
                    </div>
                    <div className="nft-details__info-row">
                        <div className="nft-details__info-label">
                            Owner
                        </div>
                        <a
                            className="nft-details__info-value"
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            href={vm.getExplorerLink(vm.nft.owner)}
                        >
                            {convertAddress(vm.nft.owner)}
                            <ExternalIcon className="nft-details__info-value-icon" />
                        </a>
                    </div>
                    <div className="nft-details__info-row">
                        <div className="nft-details__info-label">
                            Manager
                        </div>
                        <a
                            className="nft-details__info-value"
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            href={vm.getExplorerLink(vm.nft.manager)}
                        >
                            {convertAddress(vm.nft.manager)}
                            <ExternalIcon className="nft-details__info-value-icon" />
                        </a>
                    </div>
                </div>
            </Content>

            <Footer>
                <ButtonGroup vertical>
                    <Button onClick={vm.openMarketplace}>
                        {intl.formatMessage({ id: 'NFT_DETAILS_OPEN_IN_MARKETPLACE' })}
                    </Button>
                    <Button design="secondary" disabled={!vm.canTransfer} onClick={vm.onTransfer}>
                        {intl.formatMessage({ id: 'NFT_TRANSFER_BTN_TEXT' })}
                    </Button>
                </ButtonGroup>
            </Footer>
        </Container>
    )
})

function onError(e: { currentTarget: HTMLImageElement }): void {
    e.currentTarget.style.display = 'none'
}
