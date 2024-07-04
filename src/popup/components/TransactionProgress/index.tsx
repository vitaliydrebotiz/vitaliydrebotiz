import React, { useEffect, useState } from 'react'
import type nt from '@wallet/nekoton-wasm'

import Lottie from 'react-lottie-player'
import Button from '../../modules/shared/components/Button'

import FailedAnimation from '@app/popup/assets/img/lottie/failed.json'
import DoneAnimation from '@app/popup/assets/img/lottie/done.json'
import MoneyAnimation from '@app/popup/assets/img/lottie/money.json'

enum LocalStep {
    SENDING,
    SENT,
    EXPIRED,
}

type ITransactionExpired = {
    onBack: () => void
}

const TransactionExpired: React.FC<ITransactionExpired> = ({ onBack }) => {
    return (
        <>
            <h2 className="send-screen__form-title">Message expired</h2>
            <div className="send-screen__tx-sending">
                {/*@ts-ignore*/}
                <Lottie loop path={FailedAnimation} play style={{ width: 150, height: 150 }} />
            </div>
            <Button text={'OK'} type={'button'} onClick={onBack} />
        </>
    )
}

type ITransactionSent = {
    onBack: () => void
}

const TransactionSent: React.FC<ITransactionSent> = ({ onBack }) => {
    return (
        <>
            <h2 className="send-screen__form-title">Message has been sent</h2>
            <div className="send-screen__tx-sending">
                {/*@ts-ignore*/}
                <Lottie loop path={DoneAnimation} play style={{ width: 150, height: 150 }} />
            </div>
            <Button text={'OK'} type={'button'} onClick={onBack} />
        </>
    )
}

type ITransactionSending = {
    onBack: () => void
}

const TransactionSending: React.FC<ITransactionSending> = ({ onBack }) => {
    return (
        <>
            <h2 className="send-screen__form-title">Message is sending...</h2>
            <div className="send-screen__tx-sending">
                {/*@ts-ignore*/}
                <Lottie loop path={MoneyAnimation} play style={{ width: 150, height: 150 }} />
            </div>
            <Button text={'OK'} type={'button'} onClick={onBack} />
        </>
    )
}

export type ITransactionProgress = {
    pendingResponse: Promise<nt.Transaction | undefined>
    onBack: () => void
}

const TransactionProgress: React.FC<ITransactionProgress> = ({ pendingResponse, onBack }) => {
    const [localStep, setLocalStep] = useState<LocalStep>(LocalStep.SENDING)

    useEffect(() => {
        pendingResponse
            .then((_transaction) => {
                setLocalStep(LocalStep.SENT)
            })
            .catch(() => {
                setLocalStep(LocalStep.EXPIRED)
            })
    }, [])

    return (
        <>
            {localStep == LocalStep.SENDING && <TransactionSending onBack={onBack} />}
            {localStep == LocalStep.SENT && <TransactionSent onBack={onBack} />}
            {localStep == LocalStep.EXPIRED && <TransactionExpired onBack={onBack} />}
        </>
    )
}

export default TransactionProgress
