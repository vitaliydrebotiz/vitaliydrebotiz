import { ChangeEvent, FocusEvent, forwardRef } from 'react'
import { useIntl } from 'react-intl'

import { Input } from '../Input'

import './CheckSeedInput.scss'

type Props = {
    number: number;
    autoFocus?: boolean;
    name: string;
    onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

export const CheckSeedInput = forwardRef<HTMLInputElement, Props>(
    ({ number, autoFocus = false, ...props }, ref) => {
        const intl = useIntl()
        return (
            <div className="check-seed-input">
                <Input
                    placeholder={intl.formatMessage({ id: 'ENTER_THE_WORD_FIELD_PLACEHOLDER' })}
                    prefix={(
                        <div className="check-seed-input__number">
                            {number}
                            .
                        </div>
                    )}
                    autoFocus={autoFocus}
                    ref={ref}
                    {...props}
                />
            </div>
        )
    },
)
