import classNames from 'classnames'
import { HTMLAttributes, memo } from 'react'

import './Header.scss'

type Props = HTMLAttributes<HTMLElement>;

export const Header = memo(({ className, ...props }: Props): JSX.Element => (
    <header className={classNames('layout-header', className)} {...props} />
))
