import classNames from 'classnames'
import { HTMLAttributes, memo } from 'react'

import './Content.scss'

type Props = HTMLAttributes<HTMLElement>;

export const Content = memo(({ className, ...props }: Props): JSX.Element => (
    <div className={classNames('layout-content', className)} {...props} />
))
