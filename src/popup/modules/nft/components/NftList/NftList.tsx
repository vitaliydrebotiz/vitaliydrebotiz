import classNames from 'classnames'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { observer } from 'mobx-react-lite'
import { useIntl } from 'react-intl'

import { NftCollection } from '@app/models'
import {
    Container,
    Content,
    Dropdown,
    Header,
    Loader,
    SlidingPanel,
    useOnClickOutside,
    useViewModel,
} from '@app/popup/modules/shared'
import DotsIcon from '@app/popup/assets/icons/dots.svg'
import CrossIcon from '@app/popup/assets/icons/cross.svg'
import ExternalIcon from '@app/popup/assets/icons/external.svg'
import HideIcon from '@app/popup/assets/icons/eye-off.svg'

import { NftItem } from '../NftItem'
import { NftDetails } from '../NftDetails'
import { NftGrid } from '../NftGrid'
import { NftListViewModel } from './NftListViewModel'

import './NftList.scss'

interface Props {
    collection: NftCollection
}

export const NftList = observer(({ collection }: Props): JSX.Element => {
    const vm = useViewModel(NftListViewModel, (model) => {
        model.collection = collection
    })
    const loaderRef = useRef<HTMLDivElement>(null)
    const descRef = useRef<HTMLDivElement>(null)
    const intl = useIntl()

    const btnRef = useRef(null)
    const dropdownRef = useRef(null)

    useOnClickOutside(dropdownRef, btnRef, vm.hideDropdown)

    useEffect(() => {
        vm.drawer.setConfig({ showClose: false })
        return () => vm.drawer.setConfig(undefined)
    }, [])

    useEffect(() => {
        if (!loaderRef.current) return

        const observer = new IntersectionObserver(() => vm.loadMore())
        observer.observe(loaderRef.current)

        return () => observer.disconnect() // eslint-disable-line consistent-return
    }, [])

    useLayoutEffect(() => {
        if (!descRef.current) return

        if (descRef.current.clientHeight < descRef.current.scrollHeight) {
            vm.setExpanded(false)
        }
    }, [collection.description])

    return (
        <>
            <Container className="nft-list">
                <Header className="nft-list__header">
                    <h2>{collection.name}</h2>
                    <div className="nft-list__header-buttons">
                        <button
                            type="button"
                            className="nft-list__header-btn"
                            ref={btnRef}
                            onClick={vm.toggleDropdown}
                        >
                            <DotsIcon />
                        </button>
                        <button type="button" className="nft-list__header-btn" onClick={vm.drawer.close}>
                            <CrossIcon />
                        </button>

                        <Dropdown className="nft-list__dropdown" ref={dropdownRef} active={vm.dropdownActive}>
                            <button
                                type="button"
                                className="nft-list__dropdown-btn"
                                onClick={vm.openCollectionInExplorer}
                            >
                                <ExternalIcon />
                                {intl.formatMessage({ id: 'OPEN_IN_EXPLORER_BTN_TEXT' })}
                            </button>
                            <hr className="nft-list__dropdown-separator" />
                            <button
                                type="button"
                                className="nft-list__dropdown-btn _danger"
                                onClick={vm.hideCollection}
                            >
                                <HideIcon />
                                {intl.formatMessage({ id: 'NFT_HIDE_COLLECTION_BTN_TEXT' })}
                            </button>
                        </Dropdown>
                    </div>
                </Header>
                <Content className="nft-list__content">
                    {collection.description && (
                        <>
                            <div
                                className={classNames('nft-list__desc', {
                                    _expandable: vm.expanded === false,
                                    _expanded: vm.expanded,
                                })}
                                ref={descRef}
                            >
                                {collection.description}
                            </div>
                            <button className="nft-list__more-btn" type="button" onClick={() => vm.setExpanded(true)}>
                                {intl.formatMessage({ id: 'NFT_DESC_SHOW_MORE_BTN_TEXT' })}
                            </button>
                        </>
                    )}
                    <NftGrid
                        className="nft-list__grid"
                        title={intl.formatMessage({ id: 'NFT_ITEMS_TITLE' })}
                        layout={vm.grid.layout}
                        onLayoutChange={vm.grid.setLayout}
                    >
                        {vm.nfts.map((nft) => (
                            <NftGrid.Item
                                className={`nft-list__item _${vm.grid.layout}`}
                                key={nft.address}
                                onClick={() => vm.openNftDetails(nft)}
                            >
                                <NftItem layout={vm.grid.layout} item={nft} />
                                {vm.pending?.has(nft.address) && <div className="nft-list__item-dot" />}
                            </NftGrid.Item>
                        ))}
                    </NftGrid>
                    {vm.hasMore && (
                        <div className="nft-list__loader" ref={loaderRef}>
                            <Loader />
                        </div>
                    )}
                </Content>
            </Container>

            <SlidingPanel active={!!vm.selectedNft} onClose={vm.closeNftDetails}>
                <NftDetails nft={vm.selectedNft!} />
            </SlidingPanel>
        </>
    )
})
