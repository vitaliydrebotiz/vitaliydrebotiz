import { FunctionComponent, HTMLProps, memo, PropsWithChildren } from 'react'
import classNames from 'classnames'

import CardIcon from '@app/popup/assets/icons/card.svg'
import MenuIcon from '@app/popup/assets/icons/menu.svg'

import { GridLayout } from '../../store'

import './NftGrid.scss'

type Props = PropsWithChildren<{
    layout: GridLayout;
    title: string;
    className?: string;
    onLayoutChange?: (layout: GridLayout) => void;
}>

const Grid = memo(({ title, children, layout, className, onLayoutChange }: Props): JSX.Element => {
    return (
        <div className={classNames('nft-grid', `_layout-${layout}`, className)}>
            {onLayoutChange && (
                <div className="nft-grid__header">
                    <div className="nft-grid__header-title">{title}</div>
                    <div className="nft-grid__header-controls">
                        <button
                            type="button"
                            className={classNames('nft-grid__btn', { _active: layout === 'row' })}
                            onClick={() => onLayoutChange('row')}
                        >
                            <MenuIcon />
                        </button>
                        <button
                            type="button"
                            className={classNames('nft-grid__btn', { _active: layout === 'tile' })}
                            onClick={() => onLayoutChange('tile')}
                        >
                            <CardIcon />
                        </button>
                    </div>
                </div>
            )}
            <div className="nft-grid__grid">
                {children}
            </div>
        </div>
    )
})

function Item({ children, className, ...props }: HTMLProps<any>): JSX.Element {
    return (
        <div className={classNames('nft-grid__grid-item', className)} {...props}>
            {children}
        </div>
    )
}

export const NftGrid = Grid as typeof Grid & {
    Item: FunctionComponent<HTMLProps<any>>;
}

NftGrid.Item = Item as any
