import type nt from '@wallet/nekoton-wasm';
import React from 'react';
import { AccountabilityStore, SelectableKeys } from '../store';
import { useResolve } from './useResolve';

// TODO: move to mobx
export function useSelectableKeys(selectedAccount?: nt.AssetsList): SelectableKeys {
  const accountability = useResolve(AccountabilityStore);
  const account = selectedAccount || accountability.selectedAccount;

  if (account == null) {
    return { deployer: undefined, keys: [] };
  }

  const storedKeys = accountability.storedKeys;
  const accountCustodians = accountability.accountCustodians;
  const accountAddress = account.tonWallet.address;
  const accountPublicKey = account.tonWallet.publicKey;

  return React.useMemo(() => {
    const deployer = storedKeys[accountPublicKey] as nt.KeyStoreEntry | undefined;
    const custodians = accountCustodians[accountAddress] as string[] | undefined;
    const keys = custodians
      ?.map((publicKey) => storedKeys[publicKey])
      ?.filter((c) => c) ?? [];

    return { deployer, keys };
  }, [account, storedKeys, accountCustodians]);
}
