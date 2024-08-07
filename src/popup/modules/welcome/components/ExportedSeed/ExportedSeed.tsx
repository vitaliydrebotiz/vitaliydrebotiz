import React, { memo, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Button, CopyButton, SeedList } from '@app/popup/modules/shared';

import './ExportedSeed.scss';

interface Props {
  onNext: () => void;
  onBack: () => void;
  seed: string;
}

export const ExportedSeed = memo(({ onNext, onBack, seed }: Props): JSX.Element => {
  const intl = useIntl();
  const words = useMemo(() => seed.split(' '), [seed]);

  return (
    <div className="exported-seed">
      <h2 className="exported-seed__title">
        {intl.formatMessage({ id: 'SAVE_THE_SEED_PHRASE' })}
      </h2>

      <SeedList words={words} />

      <div className="exported-seed__buttons">
        <Button onClick={onNext}>
          {intl.formatMessage({ id: 'WROTE_ON_PAPER_BTN_TEXT' })}
        </Button>
        <CopyButton text={seed}>
          <Button design="secondary">
            {intl.formatMessage({ id: 'COPY_ALL_WORDS_BTN_TEXT' })}
          </Button>
        </CopyButton>
        <Button design="secondary" onClick={onBack}>
          {intl.formatMessage({ id: 'BACK_BTN_TEXT' })}
        </Button>
      </div>
    </div>
  );
});
