import {
  ConfirmMessageToPrepare,
  DeployMessageToPrepare,
  KeyToDerive,
  KeyToRemove,
  LedgerKeyToCreate,
  MasterKeyToCreate,
  Nekoton,
  NekotonRpcError,
  RpcErrorCode,
  StoredBriefMessageInfo,
  TokenMessageToPrepare,
  TokenWalletsToUpdate,
  TransferMessageToPrepare,
  WalletMessageToSend,
} from '@app/models';
import {
  AggregatedMultisigTransactionInfo,
  AggregatedMultisigTransactions,
  convertAddress,
  convertCurrency,
  convertTons,
  currentUtime,
  extractMultisigTransactionTime,
  extractTokenTransactionAddress,
  extractTokenTransactionValue,
  extractTransactionAddress,
  extractTransactionValue,
  getOrInsertDefault,
  NATIVE_CURRENCY,
  SendMessageCallback,
  TokenWalletState,
  transactionExplorerLink,
} from '@app/shared';
import { Mutex } from '@broxus/await-semaphore';
import type {
  AccountsStorage,
  AccountToAdd,
  AdditionalAssets,
  AssetsList,
  ClockWithOffset,
  ContractState,
  ContractType,
  EncryptedData,
  EncryptionAlgorithm,
  ExistingWalletInfo,
  ExportedKey,
  ExportKey,
  GetPublicKeys,
  KeyPassword,
  KeyStore,
  KeyStoreEntry,
  MultisigPendingTransaction,
  NewKey,
  PendingTransaction,
  RenameKey,
  RootTokenContractDetails,
  RootTokenContractDetailsWithAddress,
  Storage,
  Symbol,
  TokenWalletTransaction,
  TonWallet,
  TonWalletDetails,
  TonWalletInitData,
  TonWalletTransaction,
  Transaction,
  TransactionExecutionOptions,
  TransactionId,
  TransactionsBatchInfo,
  UnsignedMessage,
} from '@wallet/nekoton-wasm';
import { mergeTransactions } from 'everscale-inpage-provider/dist/utils';
import cloneDeep from 'lodash.clonedeep';
import browser from 'webextension-polyfill';
import { BACKGROUND_POLLING_INTERVAL, DEFAULT_POLLING_INTERVAL } from '../../constants';
import { LedgerBridge } from '../../ledger/LedgerBridge';
import { BaseConfig, BaseController, BaseState } from '../BaseController';
import { ConnectionController } from '../ConnectionController';
import { LocalizationController } from '../LocalizationController';
import { NotificationController } from '../NotificationController';
import { ITokenWalletHandler, TokenWalletSubscription } from './TokenWalletSubscription';
import { ITonWalletHandler, TonWalletSubscription } from './TonWalletSubscription';

export interface AccountControllerConfig extends BaseConfig {
  nekoton: Nekoton;
  storage: Storage;
  accountsStorage: AccountsStorage;
  keyStore: KeyStore;
  clock: ClockWithOffset;
  connectionController: ConnectionController;
  notificationController: NotificationController;
  localizationController: LocalizationController;
  ledgerBridge: LedgerBridge;
}

export interface AccountControllerState extends BaseState {
  accountEntries: { [address: string]: AssetsList };
  accountContractStates: { [address: string]: ContractState };
  accountCustodians: { [address: string]: string[] };
  accountTokenStates: { [address: string]: { [rootTokenContract: string]: TokenWalletState } };
  accountTransactions: { [address: string]: TonWalletTransaction[] };
  accountMultisigTransactions: { [address: string]: AggregatedMultisigTransactions };
  accountUnconfirmedTransactions: {
    [address: string]: { [transactionId: string]: MultisigPendingTransaction }
  };
  accountTokenTransactions: {
    [address: string]: { [rootTokenContract: string]: TokenWalletTransaction[] }
  };
  accountPendingTransactions: {
    [address: string]: { [messageHash: string]: StoredBriefMessageInfo }
  };
  accountFailedTransactions: {
    [address: string]: { [messageHash: string]: StoredBriefMessageInfo }
  };
  accountsVisibility: { [address: string]: boolean };
  externalAccounts: { address: string; externalIn: string[]; publicKey: string }[];
  knownTokens: { [rootTokenContract: string]: Symbol };
  recentMasterKeys: KeyStoreEntry[];
  selectedAccountAddress: string | undefined;
  selectedMasterKey: string | undefined;
  masterKeysNames: { [masterKey: string]: string };
  storedKeys: { [publicKey: string]: KeyStoreEntry };
}

const defaultState: AccountControllerState = {
  accountEntries: {},
  accountContractStates: {},
  accountCustodians: {},
  accountTokenStates: {},
  accountTransactions: {},
  accountMultisigTransactions: {},
  accountUnconfirmedTransactions: {},
  accountTokenTransactions: {},
  accountPendingTransactions: {},
  accountFailedTransactions: {},
  accountsVisibility: {},
  externalAccounts: [],
  knownTokens: {},
  masterKeysNames: {},
  recentMasterKeys: [],
  selectedAccountAddress: undefined,
  selectedMasterKey: undefined,
  storedKeys: {},
};

export class AccountController extends BaseController<AccountControllerConfig, AccountControllerState> {
  private readonly _tonWalletSubscriptions = new Map<string, TonWalletSubscription>();
  private readonly _tokenWalletSubscriptions = new Map<string, Map<string, TokenWalletSubscription>>();
  private readonly _sendMessageRequests = new Map<string, Map<string, SendMessageCallback>>();
  private readonly _accountsMutex = new Mutex();
  private _lastTransactions: Record<string, TransactionId> = {};
  private _lastTokenTransactions: Record<string, Record<string, TransactionId>> = {};

  constructor(
    config: AccountControllerConfig,
    state?: AccountControllerState,
  ) {
    super(config, state || cloneDeep(defaultState));

    this.initialize();
  }

  public async initialSync() {
    await this._loadLastTransactions();

    const keyStoreEntries = await this.config.keyStore.getKeys();
    const storedKeys: typeof defaultState.storedKeys = {};
    for (const entry of keyStoreEntries) {
      storedKeys[entry.publicKey] = entry;
    }

    let externalAccounts = await this._loadExternalAccounts();
    if (externalAccounts == null) {
      externalAccounts = [];
    }

    const accountEntries: AccountControllerState['accountEntries'] = {};
    const entries = await this.config.accountsStorage.getStoredAccounts();
    for (const entry of entries) {
      accountEntries[entry.tonWallet.address] = entry;
    }

    let selectedAccountAddress = await this._loadSelectedAccountAddress();
    let selectedAccount: AssetsList | undefined;
    if (selectedAccountAddress) {
      selectedAccount = accountEntries[selectedAccountAddress];
    }
    if (!selectedAccount) {
      selectedAccount = entries[0];
      selectedAccountAddress = selectedAccount?.tonWallet?.address;
    }

    let selectedMasterKey = await this._loadSelectedMasterKey();
    if (selectedMasterKey == null && selectedAccount !== undefined) {
      selectedMasterKey = storedKeys[selectedAccount.tonWallet.publicKey]?.masterKey;

      if (selectedMasterKey == null) {
        const address = selectedAccount.tonWallet.address;
        for (const externalAccount of externalAccounts) {
          if (externalAccount.address !== address) {
            continue;
          }

          const externalIn = externalAccount.externalIn[0] as string | undefined;
          if (externalIn != null) {
            selectedMasterKey = storedKeys[externalIn]?.masterKey;
          }
          break;
        }
      }
    }

    let accountsVisibility = await this._loadAccountsVisibility();
    if (accountsVisibility == null) {
      accountsVisibility = {};
    }

    let masterKeysNames = await this._loadMasterKeysNames();
    if (masterKeysNames == null) {
      masterKeysNames = {};
    }

    let recentMasterKeys = await this._loadRecentMasterKeys();
    if (recentMasterKeys == null) {
      recentMasterKeys = [];
    }

    this.update({
      accountsVisibility,
      selectedAccountAddress,
      accountEntries,
      externalAccounts,
      masterKeysNames,
      recentMasterKeys,
      selectedMasterKey,
      storedKeys,
    });
  }

  public async startSubscriptions() {
    console.debug('startSubscriptions');

    const selectedConnection = this.config.connectionController.state.selectedConnection;

    await this._accountsMutex.use(async () => {
      console.debug('startSubscriptions -> mutex gained');

      const accountEntries = this.state.accountEntries;
      const iterateEntries = (f: (entry: AssetsList) => void) => Promise.all(Object.values(accountEntries).map(f));

      await iterateEntries(async ({ tonWallet, additionalAssets }) => {
        await this._createTonWalletSubscription(
          tonWallet.address,
          tonWallet.publicKey,
          tonWallet.contractType,
        );

        const assets = additionalAssets[selectedConnection.group] as
          | AdditionalAssets
          | undefined;

        if (assets != null) {
          await Promise.all(
            assets.tokenWallets.map(async ({ rootTokenContract }) => {
              await this._createTokenWalletSubscription(
                tonWallet.address,
                rootTokenContract,
              );
            }),
          );
        }
      });

      console.debug('startSubscriptions -> mutex released');
    });
  }

  public async stopSubscriptions() {
    console.debug('stopSubscriptions');

    await this._accountsMutex.use(async () => {
      console.debug('stopSubscriptions -> mutex gained');
      await this._stopSubscriptions();
      console.debug('stopSubscriptions -> mutex released');
    });
  }

  public async useTonWallet<T>(address: string, f: (wallet: TonWallet) => Promise<T>) {
    const subscription = this._tonWalletSubscriptions.get(address);
    if (!subscription) {
      throw new NekotonRpcError(
        RpcErrorCode.RESOURCE_UNAVAILABLE,
        `There is no EVER wallet subscription for address ${address}`,
      );
    }
    return subscription.use(f);
  }

  public async findExistingWallets({
    publicKey,
    workchainId = 0,
    contractTypes,
  }: {
    publicKey: string
    workchainId: number
    contractTypes: ContractType[]
  }): Promise<Array<ExistingWalletInfo>> {
    return this.config.connectionController.use(async ({ data: { transport } }) => {
      try {
        return await transport.findExistingWallets(publicKey, workchainId, contractTypes);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
      }
    });
  }

  public async getTonWalletInitData(address: string): Promise<TonWalletInitData> {
    return this._getTonWalletInitData(address);
  }

  public async getTokenRootDetailsFromTokenWallet(
    tokenWalletAddress: string,
  ): Promise<RootTokenContractDetails> {
    return this.config.connectionController.use(async ({ data: { transport } }) => {
      try {
        return await transport.getTokenRootDetailsFromTokenWallet(tokenWalletAddress);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
      }
    });
  }

  public async getTokenRootDetails(rootContract: string, ownerAddress: string): Promise<RootTokenContractDetailsWithAddress> {
    return this.config.connectionController.use(async ({ data: { transport } }) => {
      try {
        return transport.getTokenRootDetails(rootContract, ownerAddress);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
      }
    });
  }

  public async getTokenWalletBalance(tokenWallet: string): Promise<string> {
    return this.config.connectionController.use(async ({ data: { transport } }) => {
      try {
        return await transport.getTokenWalletBalance(tokenWallet);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
      }
    });
  }

  public hasTokenWallet(address: string, rootTokenContract: string): boolean {
    const subscriptions = this._tokenWalletSubscriptions.get(address);
    return subscriptions?.get(rootTokenContract) != null;
  }

  public async updateTokenWallets(address: string, params: TokenWalletsToUpdate): Promise<void> {
    const { accountsStorage, connectionController } = this.config;

    const networkGroup = connectionController.state.selectedConnection.group;

    try {
      await this._accountsMutex.use(async () => {
        await Promise.all(
          Object.entries(params).map(
            async ([rootTokenContract, enabled]: readonly [string, boolean]) => {
              if (enabled) {
                await this._createTokenWalletSubscription(
                  address,
                  rootTokenContract,
                );
                await accountsStorage.addTokenWallet(
                  address,
                  networkGroup,
                  rootTokenContract,
                );
              } else {
                const tokenSubscriptions = this._tokenWalletSubscriptions.get(address);
                const subscription = tokenSubscriptions?.get(rootTokenContract);
                if (subscription != null) {
                  tokenSubscriptions?.delete(rootTokenContract);
                  await subscription.stop();
                }
                await accountsStorage.removeTokenWallet(
                  address,
                  networkGroup,
                  rootTokenContract,
                );
              }
            },
          ),
        );

        const tokenSubscriptions = this._tokenWalletSubscriptions.get(address);

        const accountTokenTransactions = this.state.accountTokenTransactions;
        const ownerTokenTransactions = {
          ...accountTokenTransactions[address],
        };

        const currentTokenContracts = Object.keys(ownerTokenTransactions);
        for (const rootTokenContract of currentTokenContracts) {
          if (tokenSubscriptions?.get(rootTokenContract) == null) {
            delete ownerTokenTransactions[rootTokenContract];
          }
        }

        if ((tokenSubscriptions?.size || 0) === 0) {
          delete accountTokenTransactions[address];
        } else {
          accountTokenTransactions[address] = ownerTokenTransactions;
        }

        const updatedState: Partial<AccountControllerState> = {
          accountTokenTransactions,
        };

        const assetsList = await accountsStorage.getAccount(address);
        if (assetsList != null) {
          const { accountEntries } = this.state;

          accountEntries[assetsList.tonWallet.address] = assetsList;
          updatedState.accountEntries = accountEntries;
        }

        this.update(updatedState);
      });
    } catch (e: any) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
    }
  }

  public async logOut() {
    console.debug('logOut');
    await this._accountsMutex.use(async () => {
      console.debug('logOut -> mutex gained');

      await this._stopSubscriptions();
      await this.config.accountsStorage.clear();
      await this.config.keyStore.clear();
      await this._removeSelectedAccountAddress();
      await this._removeSelectedMasterKey();
      await this._clearMasterKeysNames();
      await this._clearAccountsVisibility();
      await this._clearRecentMasterKeys();
      await this._clearExternalAccounts();
      this.update(cloneDeep(defaultState), true);

      console.debug('logOut -> mutex released');
    });
  }

  public async createMasterKey({
    name,
    password,
    seed,
    select,
  }: MasterKeyToCreate): Promise<KeyStoreEntry> {
    const { keyStore } = this.config;

    try {
      const newKey: NewKey = seed.mnemonicType.type === 'labs' ? {
        type: 'master_key',
        data: {
          name,
          password,
          params: {
            phrase: seed.phrase,
          },
        },
      } : {
        type: 'encrypted_key',
        data: {
          name,
          password,
          phrase: seed.phrase,
          mnemonicType: seed.mnemonicType,
        },
      };

      const entry = await keyStore.addKey(newKey);

      if (name !== undefined) {
        await this.updateMasterKeyName(entry.masterKey, name);
      }

      this.update({
        storedKeys: {
          ...this.state.storedKeys,
          [entry.publicKey]: entry,
        },
      });

      if (select) {
        await this.selectMasterKey(entry.masterKey);
      }

      return entry;
    } catch (e: any) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
    }
  }

  public async selectMasterKey(masterKey: string | undefined) {
    this.update({
      selectedMasterKey: masterKey,
    });

    await this._saveSelectedMasterKey();
  }

  public async exportMasterKey(exportKey: ExportKey): Promise<ExportedKey> {
    return this.config.keyStore.exportKey(exportKey);
  }

  public async updateMasterKeyName(masterKey: string, name: string): Promise<void> {
    this.update({
      masterKeysNames: {
        ...this.state.masterKeysNames,
        [masterKey]: name,
      },
    });

    await this._saveMasterKeysNames();
  }

  public async updateRecentMasterKey(masterKey: KeyStoreEntry): Promise<void> {
    let recentMasterKeys = this.state.recentMasterKeys.slice();

    recentMasterKeys = recentMasterKeys.filter((key) => key.masterKey !== masterKey.masterKey);
    recentMasterKeys.unshift(masterKey);
    recentMasterKeys = recentMasterKeys.slice(0, 5);

    this.update({
      recentMasterKeys,
    });

    await this._saveRecentMasterKeys();
  }

  public async getPublicKeys(params: GetPublicKeys): Promise<string[]> {
    const { keyStore } = this.config;

    try {
      const publicKeys = await keyStore.getPublicKeys(params);

      return publicKeys;
    } catch (e: any) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
    }
  }

  public async createDerivedKey(data: KeyToDerive): Promise<KeyStoreEntry> {
    const entry = await this._createDerivedKey(data);

    this.update({
      storedKeys: {
        ...this.state.storedKeys,
        [entry.publicKey]: entry,
      },
    });

    return entry;
  }

  public async createDerivedKeys(data: KeyToDerive[]): Promise<KeyStoreEntry[]> {
    const storedKeys = { ...this.state.storedKeys };

    const entries = await Promise.all(
      data.map(async (item) => {
        const entry = await this._createDerivedKey(item);
        storedKeys[entry.publicKey] = entry;
        return entry;
      }),
    );

    this.update({
      storedKeys,
    });

    return entries;
  }

  public async updateDerivedKeyName(entry: KeyStoreEntry): Promise<void> {
    const { signerName, masterKey, publicKey, name } = entry;

    let params: RenameKey;
    switch (signerName) {
      case 'master_key': {
        params = {
          type: 'master_key',
          data: {
            masterKey,
            publicKey,
            name,
          },
        };
        break;
      }
      case 'encrypted_key': {
        params = {
          type: 'encrypted_key',
          data: {
            publicKey,
            name,
          },
        };
        break;
      }
      case 'ledger_key': {
        params = {
          type: 'ledger_key',
          data: {
            publicKey,
            name,
          },
        };
        break;
      }
      default:
        return;
    }

    const newEntry = await this.config.keyStore.renameKey(params);

    this.update({
      storedKeys: {
        ...this.state.storedKeys,
        [publicKey]: newEntry,
      },
    });
  }

  public async createLedgerKey({
    accountId,
    name,
  }: LedgerKeyToCreate): Promise<KeyStoreEntry> {
    const { keyStore } = this.config;

    try {
      const entry = await keyStore.addKey({
        type: 'ledger_key',
        data: {
          name,
          accountId,
        },
      });

      this.update({
        storedKeys: {
          ...this.state.storedKeys,
          [entry.publicKey]: entry,
        },
      });

      return entry;
    } catch (e: any) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
    }
  }

  public async removeKey({ publicKey }: KeyToRemove): Promise<KeyStoreEntry | undefined> {
    const entry = await this._removeKey({ publicKey });
    const storedKeys = { ...this.state.storedKeys };
    delete storedKeys[publicKey];

    this.update({
      storedKeys,
    });

    return entry;
  }

  public async removeKeys(data: KeyToRemove[]): Promise<Array<KeyStoreEntry | undefined>> {
    const storedKeys = { ...this.state.storedKeys };
    const entries = await Promise.all(
      data.map(async (item) => {
        const entry = await this._removeKey(item);
        delete storedKeys[item.publicKey];
        return entry;
      }),
    );

    this.update({
      storedKeys,
    });

    return entries;
  }

  public getLedgerMasterKey() {
    const { ledgerBridge } = this.config;
    return ledgerBridge.getPublicKey(0);
  }

  public getLedgerFirstPage() {
    const { ledgerBridge } = this.config;
    return ledgerBridge.getFirstPage();
  }

  public getLedgerNextPage() {
    const { ledgerBridge } = this.config;
    return ledgerBridge.getNextPage();
  }

  public getLedgerPreviousPage() {
    const { ledgerBridge } = this.config;
    return ledgerBridge.getPreviousPage();
  }

  public async createAccount(params: AccountToAdd): Promise<AssetsList> {
    const { accountsStorage } = this.config;

    try {
      const selectedAccount = await accountsStorage.addAccount(params);

      const accountEntries = {
        ...this.state.accountEntries,
        [selectedAccount.tonWallet.address]: selectedAccount,
      };

      await this.updateAccountVisibility(selectedAccount.tonWallet.address, true);

      this.update({
        accountEntries,
        selectedAccountAddress: selectedAccount.tonWallet.address,
      });

      await this._saveSelectedAccountAddress();
      await this.startSubscriptions();

      return selectedAccount;
    } catch (e: any) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
    }
  }

  public async createAccounts(params: AccountToAdd[]): Promise<AssetsList[]> {
    const { accountsStorage } = this.config;

    try {
      const newAccounts = await accountsStorage.addAccounts(params);

      const accountEntries = { ...this.state.accountEntries };
      const accountsVisibility: { [address: string]: boolean } = {};
      for (const account of newAccounts) {
        accountsVisibility[account.tonWallet.address] = true;
        accountEntries[account.tonWallet.address] = account;
      }

      this.update({
        accountsVisibility: {
          ...this.state.accountsVisibility,
          ...accountsVisibility,
        },
        accountEntries,
      });

      // TODO: select first account?

      await this.startSubscriptions();
      return newAccounts;
    } catch (e: any) {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
    }
  }

  public async addExternalAccount(
    address: string,
    publicKey: string,
    externalPublicKey: string,
  ): Promise<void> {
    let { externalAccounts } = this.state;
    const entry = externalAccounts.find((account) => account.address === address);

    if (entry == null) {
      externalAccounts.unshift({ address, publicKey, externalIn: [externalPublicKey] });
      this.update({
        externalAccounts,
      });
      await this._saveExternalAccounts();
      return;
    }

    if (!entry.externalIn.includes(externalPublicKey)) {
      entry.externalIn.push(externalPublicKey);
    }

    externalAccounts = externalAccounts.filter((account) => account.address !== address);
    externalAccounts.unshift(entry);

    this.update({
      externalAccounts,
    });

    await this._saveExternalAccounts();
  }

  public async selectAccount(address: string) {
    console.debug('selectAccount');

    await this._accountsMutex.use(async () => {
      console.debug('selectAccount -> mutex gained');

      const selectedAccount = Object.values(this.state.accountEntries).find(
        (entry) => entry.tonWallet.address === address,
      );

      if (selectedAccount) {
        this.update({
          selectedAccountAddress: selectedAccount.tonWallet.address,
        });

        await this._saveSelectedAccountAddress();
      }

      console.debug('selectAccount -> mutex released');
    });
  }

  public async removeAccount(address: string) {
    await this._accountsMutex.use(async () => {
      await this.config.accountsStorage.removeAccount(address);

      const subscription = this._tonWalletSubscriptions.get(address);
      this._tonWalletSubscriptions.delete(address);
      if (subscription != null) {
        await subscription.stop();
      }

      const tokenSubscriptions = this._tokenWalletSubscriptions.get(address);
      this._tokenWalletSubscriptions.delete(address);
      if (tokenSubscriptions != null) {
        await Promise.all(
          Array.from(tokenSubscriptions.values()).map((item) => item.stop()),
        );
      }

      const accountEntries = { ...this.state.accountEntries };
      delete accountEntries[address];

      const accountContractStates = { ...this.state.accountContractStates };
      delete accountContractStates[address];

      const accountTransactions = { ...this.state.accountTransactions };
      delete accountTransactions[address];

      const accountTokenTransactions = { ...this.state.accountTokenTransactions };
      delete accountTokenTransactions[address];

      // TODO: select current account

      this.update({
        accountEntries,
        accountContractStates,
        accountTransactions,
        accountTokenTransactions,
      });
    });
  }

  public async removeAccounts(addresses: string[]) {
    return Promise.all(addresses.map((address) => this.removeAccount(address)));
  }

  public async renameAccount(address: string, name: string): Promise<void> {
    await this._accountsMutex.use(async () => {
      const accountEntry = await this.config.accountsStorage.renameAccount(address, name);

      this.update({
        accountEntries: {
          ...this.state.accountEntries,
          [address]: accountEntry,
        },
      });
    });
  }

  public async updateAccountVisibility(address: string, value: boolean): Promise<void> {
    this.update({
      accountsVisibility: {
        ...this.state.accountsVisibility,
        [address]: value,
      },
    });

    await this._saveAccountsVisibility();
  }

  public async checkPassword(password: KeyPassword) {
    if (password.type === 'ledger_key') {
      return Promise.resolve(true);
    }

    return this.config.keyStore.check_password(password);
  }

  public async isPasswordCached(publicKey: string): Promise<boolean> {
    return this.config.keyStore.isPasswordCached(publicKey);
  }

  public async estimateFees(
    address: string,
    params: TransferMessageToPrepare,
    executionOptions: TransactionExecutionOptions,
  ) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    return subscription.use(async (wallet) => {
      const contractState = await wallet.getContractState();
      if (contractState == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          `Failed to get contract state for ${address}`,
        );
      }

      const unsignedMessage = wallet.prepareTransfer(
        contractState,
        params.publicKey,
        params.recipient,
        params.amount,
        false,
        params.payload || '',
        60,
      );
      if (unsignedMessage == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          'Contract must be deployed first',
        );
      }

      try {
        const signedMessage = unsignedMessage.signFake();
        return await wallet.estimateFees(signedMessage, executionOptions);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      } finally {
        unsignedMessage.free();
      }
    });
  }

  public async estimateConfirmationFees(address: string, params: ConfirmMessageToPrepare) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    return subscription.use(async (wallet) => {
      const contractState = await wallet.getContractState();
      if (contractState == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          `Failed to get contract state for ${address}`,
        );
      }

      const unsignedMessage = wallet.prepareConfirm(
        contractState,
        params.publicKey,
        params.transactionId,
        60,
      );

      try {
        const signedMessage = unsignedMessage.signFake();
        return await wallet.estimateFees(signedMessage, {});
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      } finally {
        unsignedMessage.free();
      }
    });
  }

  public async estimateDeploymentFees(address: string): Promise<string> {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    return subscription.use(async (wallet) => {
      const contractState = await wallet.getContractState();
      if (contractState == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          `Failed to get contract state for ${address}`,
        );
      }

      const unsignedMessage = wallet.prepareDeploy(60);
      try {
        const signedMessage = unsignedMessage.signFake();
        return await wallet.estimateFees(signedMessage, {
          overrideBalance: '100000000000',
        });
      } catch (e: any) {
        console.error(e);
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      } finally {
        unsignedMessage.free();
      }
    });
  }

  public async getMultisigPendingTransactions(address: string) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    return subscription.use(async (wallet) => {
      try {
        return wallet.getMultisigPendingTransactions();
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      }
    });
  }

  public async prepareTransferMessage(
    address: string,
    params: TransferMessageToPrepare,
    password: KeyPassword,
  ) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    return subscription.use(async (wallet) => {
      const contractState = await wallet.getContractState();
      if (contractState == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          `Failed to get contract state for ${address}`,
        );
      }

      const unsignedMessage = wallet.prepareTransfer(
        contractState,
        params.publicKey,
        params.recipient,
        params.amount,
        false,
        params.payload || '',
        60,
      );
      if (unsignedMessage == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          'Contract must be deployed first',
        );
      }

      try {
        return await this.config.keyStore.sign(unsignedMessage, password);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      } finally {
        unsignedMessage.free();
      }
    });
  }

  public async prepareConfirmMessage(
    address: string,
    params: ConfirmMessageToPrepare,
    password: KeyPassword,
  ) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    return subscription.use(async (wallet) => {
      const contractState = await wallet.getContractState();
      if (contractState == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          `Failed to get contract state for ${address}`,
        );
      }

      let unsignedMessage: UnsignedMessage | undefined;
      try {
        unsignedMessage = wallet.prepareConfirm(
          contractState,
          params.publicKey,
          params.transactionId,
          60,
        );

        return await this.config.keyStore.sign(unsignedMessage, password);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      } finally {
        unsignedMessage?.free();
      }
    });
  }

  public async prepareDeploymentMessage(
    address: string,
    params: DeployMessageToPrepare,
    password: KeyPassword,
  ) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    return subscription.use(async (wallet) => {
      const contractState = await wallet.getContractState();
      if (contractState == null) {
        throw new NekotonRpcError(
          RpcErrorCode.RESOURCE_UNAVAILABLE,
          `Failed to get contract state for ${address}`,
        );
      }

      let unsignedMessage: UnsignedMessage;
      if (params.type === 'single_owner') {
        unsignedMessage = wallet.prepareDeploy(60);
      } else {
        unsignedMessage = wallet.prepareDeployWithMultipleOwners(
          60,
          params.custodians,
          params.reqConfirms,
        );
      }

      try {
        return await this.config.keyStore.sign(unsignedMessage, password);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      } finally {
        unsignedMessage.free();
      }
    });
  }

  public async prepareTokenMessage(
    owner: string,
    rootTokenContract: string,
    params: TokenMessageToPrepare,
  ) {
    const subscription = await this._tokenWalletSubscriptions.get(owner)?.get(rootTokenContract);
    requireTokenWalletSubscription(owner, rootTokenContract, subscription);

    return subscription.use(async (wallet) => {
      try {
        return await wallet.prepareTransfer(
          params.recipient,
          params.amount,
          params.payload || '',
          params.notifyReceiver,
        );
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.INTERNAL, e.toString());
      }
    });
  }

  public async signData(data: string, password: KeyPassword) {
    return this.config.keyStore.signData(data, password);
  }

  public async signDataRaw(data: string, password: KeyPassword) {
    return this.config.keyStore.signDataRaw(data, password);
  }

  public async signPreparedMessage(
    unsignedMessage: UnsignedMessage,
    password: KeyPassword,
  ) {
    return this.config.keyStore.sign(unsignedMessage, password);
  }

  public async encryptData(
    data: string,
    recipientPublicKeys: string[],
    algorithm: EncryptionAlgorithm,
    password: KeyPassword,
  ) {
    return this.config.keyStore.encryptData(data, recipientPublicKeys, algorithm, password);
  }

  public async decryptData(data: EncryptedData, password: KeyPassword) {
    return this.config.keyStore.decryptData(data, password);
  }

  public async sendMessage(address: string, { signedMessage, info }: WalletMessageToSend) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    let accountMessageRequests = await this._sendMessageRequests.get(address);
    if (accountMessageRequests == null) {
      accountMessageRequests = new Map();
      this._sendMessageRequests.set(address, accountMessageRequests);
    }

    const id = signedMessage.hash;
    const result = new Promise<Transaction>((resolve, reject) => {
      accountMessageRequests!.set(id, { resolve, reject });
    });

    await subscription.prepareReliablePolling();
    await this.useTonWallet(address, async (wallet) => {
      try {
        const pendingTransaction = await wallet.sendMessage(signedMessage);

        if (info != null) {
          const accountPendingTransactions = {
            ...this.state.accountPendingTransactions,
          };
          const pendingTransactions = getOrInsertDefault(
            accountPendingTransactions,
            address,
          );
          pendingTransactions[pendingTransaction.messageHash] = {
            ...info,
            createdAt: currentUtime(this.config.clock.offsetMs()),
            messageHash: signedMessage.hash,
          } as StoredBriefMessageInfo;

          this.update({
            accountPendingTransactions,
          });
        }

        subscription.skipRefreshTimer();
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.RESOURCE_UNAVAILABLE, e.toString());
      }
    }).catch((e) => {
      this._rejectMessageRequest(address, id, e);
    });

    return result;
  }

  public async preloadTransactions(address: string, lt: string) {
    const subscription = await this._tonWalletSubscriptions.get(address);
    requireTonWalletSubscription(address, subscription);

    await subscription.use(async (wallet) => {
      try {
        await wallet.preloadTransactions(lt);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.RESOURCE_UNAVAILABLE, e.toString());
      }
    });
  }

  public async preloadTokenTransactions(owner: string, rootTokenContract: string, lt: string) {
    const subscription = this._tokenWalletSubscriptions.get(owner)?.get(rootTokenContract);
    if (!subscription) {
      throw new NekotonRpcError(
        RpcErrorCode.RESOURCE_UNAVAILABLE,
        `There is no token wallet subscription for address ${owner} for root ${rootTokenContract}`,
      );
    }

    await subscription.use(async (wallet) => {
      try {
        await wallet.preloadTransactions(lt);
      } catch (e: any) {
        throw new NekotonRpcError(RpcErrorCode.RESOURCE_UNAVAILABLE, e.toString());
      }
    });
  }

  public enableIntensivePolling() {
    console.debug('Enable intensive polling');
    this._tonWalletSubscriptions.forEach((subscription) => {
      subscription.skipRefreshTimer();
      subscription.setPollingInterval(DEFAULT_POLLING_INTERVAL);
    });
    this._tokenWalletSubscriptions.forEach((subscriptions) => {
      subscriptions.forEach((subscription) => {
        subscription.skipRefreshTimer();
        subscription.setPollingInterval(DEFAULT_POLLING_INTERVAL);
      });
    });
  }

  public disableIntensivePolling() {
    console.debug('Disable intensive polling');
    this._tonWalletSubscriptions.forEach((subscription) => {
      subscription.setPollingInterval(BACKGROUND_POLLING_INTERVAL);
    });
    this._tokenWalletSubscriptions.forEach((subscriptions) => {
      subscriptions.forEach((subscription) => {
        subscription.setPollingInterval(BACKGROUND_POLLING_INTERVAL);
      });
    });
  }

  private async _createTonWalletSubscription(
    address: string,
    publicKey: string,
    contractType: ContractType,
  ) {
    if (this._tonWalletSubscriptions.get(address) != null) {
      return;
    }

    class TonWalletHandler implements ITonWalletHandler {
      private readonly _address: string;
      private readonly _walletDetails: TonWalletDetails;
      private readonly _controller: AccountController;

      constructor(
        address: string,
        contractType: ContractType,
        controller: AccountController,
      ) {
        this._address = address;
        this._walletDetails = controller.config.nekoton.getContractTypeDetails(contractType);
        this._controller = controller;
      }

      onMessageExpired(pendingTransaction: PendingTransaction) {
        this._controller._clearPendingTransaction(
          this._address,
          pendingTransaction.messageHash,
          false,
        );
        this._controller._rejectMessageRequest(
          this._address,
          pendingTransaction.messageHash,
          new NekotonRpcError(RpcErrorCode.INTERNAL, 'Message expired'),
        );
      }

      onMessageSent(pendingTransaction: PendingTransaction, transaction: Transaction) {
        this._controller._clearPendingTransaction(
          this._address,
          pendingTransaction.messageHash,
          true,
        );
        this._controller._resolveMessageRequest(
          this._address,
          pendingTransaction.messageHash,
          transaction,
        );
      }

      onStateChanged(newState: ContractState) {
        this._controller._updateTonWalletState(this._address, newState);
      }

      onTransactionsFound(
        transactions: Array<TonWalletTransaction>,
        info: TransactionsBatchInfo,
      ) {
        this._controller._updateTransactions(
          this._address,
          this._walletDetails,
          transactions,
          info,
        );
      }

      onUnconfirmedTransactionsChanged(
        unconfirmedTransactions: MultisigPendingTransaction[],
      ) {
        this._controller._updateUnconfirmedTransactions(
          this._address,
          unconfirmedTransactions,
        );
      }

      onCustodiansChanged(custodians: string[]) {
        this._controller._updateCustodians(this._address, custodians);
      }
    }

    let subscription;
    const handler = new TonWalletHandler(address, contractType, this);

    console.debug('_createTonWalletSubscription -> subscribing to EVER wallet');
    if (this.config.connectionController.isFromZerostate(address)) {
      subscription = await TonWalletSubscription.subscribeByAddress(
        this.config.clock,
        this.config.connectionController,
        address,
        handler,
      );
    } else {
      subscription = await TonWalletSubscription.subscribe(
        this.config.clock,
        this.config.connectionController,
        this.config.nekoton.extractAddressWorkchain(address),
        publicKey,
        contractType,
        handler,
      );
    }
    console.debug('_createTonWalletSubscription -> subscribed to EVER wallet');

    this._tonWalletSubscriptions.set(address, subscription);
    subscription?.setPollingInterval(BACKGROUND_POLLING_INTERVAL);

    await subscription?.start();
  }

  private async _createDerivedKey({
    accountId,
    masterKey,
    name,
    password,
  }: KeyToDerive): Promise<KeyStoreEntry> {
    const { keyStore } = this.config;

    return keyStore
      .addKey({
        type: 'master_key',
        data: {
          name,
          password,
          params: { masterKey, accountId },
        },
      })
      .catch((e) => {
        throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
      });
  }

  public async _removeKey({ publicKey }: KeyToRemove): Promise<KeyStoreEntry | undefined> {
    const { keyStore } = this.config;

    return keyStore.removeKey(publicKey).catch((e) => {
      throw new NekotonRpcError(RpcErrorCode.INVALID_REQUEST, e.toString());
    });
  }

  private async _getTonWalletInitData(address: string): Promise<TonWalletInitData> {
    return this.config.connectionController.use(
      ({ data: { transport } }) => transport.getNativeWalletInitData(address),
    );
  }

  private async _createTokenWalletSubscription(owner: string, rootTokenContract: string) {
    let ownerSubscriptions = this._tokenWalletSubscriptions.get(owner);
    if (ownerSubscriptions == null) {
      ownerSubscriptions = new Map();
      this._tokenWalletSubscriptions.set(owner, ownerSubscriptions);
    }

    if (ownerSubscriptions.get(rootTokenContract) != null) {
      return;
    }

    class TokenWalletHandler implements ITokenWalletHandler {
      private readonly _owner: string;
      private readonly _rootTokenContract: string;
      private readonly _controller: AccountController;
      private readonly _mutex: Mutex;

      constructor(owner: string, rootTokenContract: string, controller: AccountController, mutex: Mutex) {
        this._owner = owner;
        this._rootTokenContract = rootTokenContract;
        this._controller = controller;
        this._mutex = mutex;
      }

      onBalanceChanged(balance: string) {
        this._controller._updateTokenWalletState(
          this._owner,
          this._rootTokenContract,
          balance,
        );
      }

      onTransactionsFound(
        transactions: Array<TokenWalletTransaction>,
        info: TransactionsBatchInfo,
      ) {
        this._mutex.use(async () => { // wait until knownTokens updated
          this._controller._updateTokenTransactions(
            this._owner,
            this._rootTokenContract,
            transactions,
            info,
          );
        });
      }
    }

    console.debug('_createTokenWalletSubscription -> subscribing to token wallet');
    const mutex = new Mutex();
    const resolve = await mutex.acquire();
    const subscription = await TokenWalletSubscription.subscribe(
      this.config.connectionController,
      owner,
      rootTokenContract,
      new TokenWalletHandler(owner, rootTokenContract, this, mutex),
    );
    console.debug('_createTokenWalletSubscription -> subscribed to token wallet');

    this.update({
      knownTokens: {
        ...this.state.knownTokens,
        [rootTokenContract]: subscription.symbol,
      },
    });
    resolve(); // resolve mutex after knownTokens updated

    ownerSubscriptions.set(rootTokenContract, subscription);
    subscription.setPollingInterval(BACKGROUND_POLLING_INTERVAL);

    await subscription.start();
  }

  private async _stopSubscriptions() {
    const stopTonSubscriptions = async () => {
      await Promise.all(
        Array.from(this._tonWalletSubscriptions.values()).map((item) => item.stop()),
      );
    };

    const stopTokenSubscriptions = async () => {
      await Promise.all(
        Array.from(this._tokenWalletSubscriptions.values()).map(
          (subscriptions) => Promise.all(
            Array.from(subscriptions.values()).map((item) => item.stop()),
          ),
        ),
      );
    };

    await Promise.all([stopTonSubscriptions(), stopTokenSubscriptions()]);

    this._tonWalletSubscriptions.clear();
    this._tokenWalletSubscriptions.clear();
    this._clearSendMessageRequests();

    this.update({
      accountContractStates: {},
      accountTokenStates: {},
      accountTransactions: {},
      accountTokenTransactions: {},
      accountMultisigTransactions: {},
      accountUnconfirmedTransactions: {},
      accountPendingTransactions: {},
      accountFailedTransactions: {},
    });
  }

  private _clearSendMessageRequests() {
    const rejectionError = new NekotonRpcError(
      RpcErrorCode.RESOURCE_UNAVAILABLE,
      'The request was rejected; please try again',
    );

    const addresses = Array.from(this._sendMessageRequests.keys());
    for (const address of addresses) {
      const ids = Array.from(this._sendMessageRequests.get(address)?.keys() || []);
      for (const id of ids) {
        this._rejectMessageRequest(address, id, rejectionError);
      }
    }
    this._sendMessageRequests.clear();
  }

  private _rejectMessageRequest(address: string, id: string, error: Error) {
    this._deleteMessageRequestAndGetCallback(address, id).reject(error);
  }

  private _resolveMessageRequest(address: string, id: string, transaction: Transaction) {
    this._deleteMessageRequestAndGetCallback(address, id).resolve(transaction);
  }

  private _deleteMessageRequestAndGetCallback(address: string, id: string): SendMessageCallback {
    const callbacks = this._sendMessageRequests.get(address)?.get(id);
    if (!callbacks) {
      throw new Error(`SendMessage request with id "${id}" not found`);
    }

    this._deleteMessageRequest(address, id);
    return callbacks;
  }

  private _deleteMessageRequest(address: string, id: string) {
    const accountMessageRequests = this._sendMessageRequests.get(address);
    if (!accountMessageRequests) {
      return;
    }
    accountMessageRequests.delete(id);
    if (accountMessageRequests.size === 0) {
      this._sendMessageRequests.delete(address);
    }
  }

  private _clearPendingTransaction(address: string, messageHash: string, sent: boolean) {
    const { accountPendingTransactions, accountFailedTransactions } = this.state;

    const update = {
      accountPendingTransactions,
    } as Partial<AccountControllerState>;

    const pendingTransactions = getOrInsertDefault(accountPendingTransactions, address);
    const info = pendingTransactions[messageHash] as StoredBriefMessageInfo | undefined;
    if (info == null) {
      return;
    }

    delete pendingTransactions[messageHash];

    if (!sent) {
      const failedTransactions = getOrInsertDefault(accountFailedTransactions, address);
      failedTransactions[messageHash] = info;
      update.accountFailedTransactions = accountFailedTransactions;
    }

    this.update(update);
  }

  private _updateTonWalletState(address: string, state: ContractState) {
    const currentStates = this.state.accountContractStates;

    const currentState = currentStates[address] as ContractState | undefined;
    if (
      currentState?.balance === state.balance &&
      currentState?.isDeployed === state.isDeployed &&
      currentState?.lastTransactionId?.lt === state.lastTransactionId?.lt
    ) {
      return;
    }

    const newStates = {
      ...currentStates,
      [address]: state,
    };
    this.update({
      accountContractStates: newStates,
    });
  }

  private _updateTokenWalletState(owner: string, rootTokenContract: string, balance: string) {
    const accountTokenStates = this.state.accountTokenStates;
    const ownerTokenStates = {
      ...accountTokenStates[owner],
      [rootTokenContract]: {
        balance,
      } as TokenWalletState,
    };
    const newBalances = {
      ...accountTokenStates,
      [owner]: ownerTokenStates,
    };
    this.update({
      accountTokenStates: newBalances,
    });
  }

  private _updateTransactions(
    address: string,
    walletDetails: TonWalletDetails,
    transactions: TonWalletTransaction[],
    info: TransactionsBatchInfo,
  ) {
    const network = this.config.connectionController.state.selectedConnection.group;
    const newTransactions = this._findNewTransactions(address, transactions, info);

    this._updateLastTransaction(address, (newTransactions[0] ?? transactions[0]).id);

    if (newTransactions.length) {
      const { notificationController, localizationController } = this.config;

      for (const transaction of newTransactions) {
        const value = extractTransactionValue(transaction);
        const { address, direction } = extractTransactionAddress(transaction);

        let title = localizationController.localize('NEW_TRANSACTION_FOUND');
        if (
          transaction.info?.type === 'wallet_interaction' &&
          transaction.info.data.method.type === 'multisig'
        ) {
          switch (transaction.info.data.method.data.type) {
            case 'confirm': {
              title = localizationController.localize(
                'MULTISIG_TRANSACTION_CONFIRMATION',
              );
              break;
            }
            case 'submit': {
              title = localizationController.localize(
                'NEW_MULTISIG_TRANSACTION_FOUND',
              );
              break;
            }
            default: {
              break;
            }
          }
        }

        const body = `${convertTons(
          value.toString(),
        )} ${NATIVE_CURRENCY} ${localizationController.localize(
          `TRANSACTION_DIRECTION_${direction.toLocaleUpperCase()}` as any,
        )} ${convertAddress(address)}`;

        notificationController.showNotification({
          title,
          body,
          link: transactionExplorerLink({
            network,
            hash: transaction.id.hash,
          }),
        });
      }
    }

    const currentTransactions = this.state.accountTransactions;
    const accountTransactions = {
      ...currentTransactions,
      [address]: mergeTransactions(currentTransactions[address] || [], transactions, info),
    };

    const update = { accountTransactions } as Partial<AccountControllerState>;

    let multisigTransactions = this.state.accountMultisigTransactions[address] as
      | AggregatedMultisigTransactions
      | undefined;
    let multisigTransactionsChanged = false;

    if (walletDetails.supportsMultipleOwners) {
      // eslint-disable-next-line no-labels
      outer: for (const transaction of transactions) {
        if (transaction.info?.type !== 'wallet_interaction') {
          continue;
        }

        if (transaction.info.data.method.type !== 'multisig') {
          break;
        }

        const method = transaction.info.data.method.data;

        switch (method.type) {
          case 'submit': {
            const transactionId = method.data.transactionId;
            if (
              transactionId === '0' ||
              transaction.outMessages.some((msg) => msg.dst != null)
            ) {
              break outer; // eslint-disable-line no-labels
            }

            if (multisigTransactions == null) {
              multisigTransactions = {};
              this.state.accountMultisigTransactions[address] = multisigTransactions;
            }

            multisigTransactionsChanged = true;

            const multisigTransaction = multisigTransactions[transactionId] as
              | AggregatedMultisigTransactionInfo
              | undefined;
            if (multisigTransaction == null) {
              multisigTransactions[transactionId] = {
                confirmations: [method.data.custodian],
                createdAt: transaction.createdAt,
              };
            } else {
              multisigTransaction.createdAt = transaction.createdAt;
              multisigTransaction.confirmations.push(method.data.custodian);
            }

            break;
          }
          case 'confirm': {
            const transactionId = method.data.transactionId;

            if (multisigTransactions == null) {
              multisigTransactions = {};
              this.state.accountMultisigTransactions[address] = multisigTransactions;
            }

            multisigTransactionsChanged = true;

            const finalTransactionHash = transaction.outMessages.length > 0 ? transaction.id.hash : undefined;

            const multisigTransaction = multisigTransactions[transactionId] as
              | AggregatedMultisigTransactionInfo
              | undefined;
            if (multisigTransaction == null) {
              multisigTransactions[transactionId] = {
                finalTransactionHash,
                confirmations: [method.data.custodian],
                createdAt: extractMultisigTransactionTime(transactionId),
              };
            } else {
              if (finalTransactionHash != null) {
                multisigTransaction.finalTransactionHash = finalTransactionHash;
              }
              multisigTransaction.confirmations.push(method.data.custodian);
            }

            break;
          }
          default:
            break;
        }
      }
    }

    if (multisigTransactionsChanged) {
      update.accountMultisigTransactions = this.state.accountMultisigTransactions;
    }

    this.update(update);
  }

  private _updateUnconfirmedTransactions(
    address: string,
    unconfirmedTransactions: MultisigPendingTransaction[],
  ) {
    let { accountUnconfirmedTransactions } = this.state;

    const entries: { [transitionId: string]: MultisigPendingTransaction } = {};

    unconfirmedTransactions.forEach((transaction) => {
      entries[transaction.id] = transaction;
    });

    accountUnconfirmedTransactions = {
      ...accountUnconfirmedTransactions,
      [address]: entries,
    };

    this.update({
      accountUnconfirmedTransactions,
    });
  }

  private _updateCustodians(address: string, custodians: string[]) {
    const { accountCustodians } = this.state;
    accountCustodians[address] = custodians;
    this.update({
      accountCustodians,
    });
  }

  private _updateTokenTransactions(
    owner: string,
    rootTokenContract: string,
    transactions: TokenWalletTransaction[],
    info: TransactionsBatchInfo,
  ) {
    const network = this.config.connectionController.state.selectedConnection.group;
    const newTransactions = this._findNewTokenTransactions(owner, rootTokenContract, transactions, info);

    this._updateLastTokenTransaction(
      owner,
      rootTokenContract,
      (newTransactions[0] ?? transactions[0]).id,
    );

    if (newTransactions.length) {
      const symbol = this.state.knownTokens[rootTokenContract];
      if (symbol != null) {
        const { notificationController, localizationController } = this.config;

        for (const transaction of newTransactions) {
          const value = extractTokenTransactionValue(transaction);
          if (value == null) {
            continue;
          }

          const direction = extractTokenTransactionAddress(transaction);

          const body: string = `${convertCurrency(value.toString(), symbol.decimals)} ${
            symbol.name
          } ${value.lt(0) ? 'to' : 'from'} ${direction?.address}`;

          notificationController.showNotification({
            title: localizationController.localize('NEW_TOKEN_TRANSACTION_FOUND'),
            body,
            link: transactionExplorerLink({
              network,
              hash: transaction.id.hash,
            }),
          });
        }
      }
    }

    const currentTransactions = this.state.accountTokenTransactions;

    const ownerTransactions = currentTransactions[owner] || [];
    const newOwnerTransactions = {
      ...ownerTransactions,
      [rootTokenContract]: mergeTransactions(
        ownerTransactions[rootTokenContract] || [],
        transactions,
        info,
      ),
    };

    const accountTokenTransactions = {
      ...currentTransactions,
      [owner]: newOwnerTransactions,
    };

    this.update({ accountTokenTransactions });
  }

  private async _loadSelectedAccountAddress(): Promise<string | undefined> {
    const { selectedAccountAddress } = await browser.storage.local.get([
      'selectedAccountAddress',
    ]);

    if (typeof selectedAccountAddress === 'string') {
      return selectedAccountAddress;
    }

    return undefined;
  }

  private async _saveSelectedAccountAddress(): Promise<void> {
    await browser.storage.local.set({
      selectedAccountAddress: this.state.selectedAccountAddress,
    });
  }

  private async _removeSelectedAccountAddress(): Promise<void> {
    await browser.storage.local.remove('selectedAccountAddress');
  }

  private async _loadSelectedMasterKey(): Promise<string | undefined> {
    const { selectedMasterKey } = await browser.storage.local.get(['selectedMasterKey']);
    if (typeof selectedMasterKey === 'string') {
      return selectedMasterKey;
    }

    return undefined;
  }

  private async _saveSelectedMasterKey(): Promise<void> {
    await browser.storage.local.set({ selectedMasterKey: this.state.selectedMasterKey });
  }

  private async _removeSelectedMasterKey(): Promise<void> {
    await browser.storage.local.remove('selectedMasterKey');
  }

  private async _loadMasterKeysNames(): Promise<AccountControllerState['masterKeysNames'] | undefined> {
    const { masterKeysNames } = await browser.storage.local.get(['masterKeysNames']);
    if (typeof masterKeysNames === 'object') {
      return masterKeysNames;
    }

    return undefined;
  }

  private async _clearMasterKeysNames(): Promise<void> {
    await browser.storage.local.remove('masterKeysNames');
  }

  private async _saveMasterKeysNames(): Promise<void> {
    await browser.storage.local.set({ masterKeysNames: this.state.masterKeysNames });
  }

  private async _loadRecentMasterKeys(): Promise<AccountControllerState['recentMasterKeys'] | undefined> {
    const { recentMasterKeys } = await browser.storage.local.get(['recentMasterKeys']);
    if (Array.isArray(recentMasterKeys)) {
      return recentMasterKeys;
    }

    return undefined;
  }

  private async _clearRecentMasterKeys(): Promise<void> {
    await browser.storage.local.remove('recentMasterKeys');
  }

  private async _saveRecentMasterKeys(): Promise<void> {
    await browser.storage.local.set({ recentMasterKeys: this.state.recentMasterKeys });
  }

  private async _loadAccountsVisibility(): Promise<AccountControllerState['accountsVisibility'] | undefined> {
    const { accountsVisibility } = await browser.storage.local.get([
      'accountsVisibility',
    ]);

    if (typeof accountsVisibility === 'object') {
      return accountsVisibility;
    }

    return undefined;
  }

  private async _clearAccountsVisibility(): Promise<void> {
    await browser.storage.local.remove('accountsVisibility');
  }

  private async _saveAccountsVisibility(): Promise<void> {
    await browser.storage.local.set({
      accountsVisibility: this.state.accountsVisibility,
    });
  }

  private async _loadExternalAccounts(): Promise<AccountControllerState['externalAccounts'] | undefined> {
    const { externalAccounts } = await browser.storage.local.get(['externalAccounts']);

    if (Array.isArray(externalAccounts)) {
      return externalAccounts;
    }

    return undefined;
  }

  private async _clearExternalAccounts(): Promise<void> {
    await browser.storage.local.remove('externalAccounts');
  }

  private async _saveExternalAccounts(): Promise<void> {
    await browser.storage.local.set({ externalAccounts: this.state.externalAccounts });
  }

  private async _loadLastTransactions(): Promise<void> {
    const {
      lastTransactions,
      lastTokenTransactions,
    } = await chrome.storage.session.get(['lastTransactions', 'lastTokenTransactions']);

    this._lastTransactions = lastTransactions ?? {};
    this._lastTokenTransactions = lastTokenTransactions ?? {};
  }

  private _updateLastTransaction(address: string, id: TransactionId) {
    const prevLt = this._lastTransactions[address]?.lt ?? '0';

    if (BigInt(prevLt) >= BigInt(id.lt)) return;

    this._lastTransactions = {
      ...this._lastTransactions,
      [address]: id,
    };

    chrome.storage.session.set({
      lastTransactions: this._lastTransactions,
    }).catch(console.error);
  }

  private _updateLastTokenTransaction(owner: string, rootTokenContract: string, id: TransactionId) {
    const prevLt = this._lastTokenTransactions[owner]?.[rootTokenContract]?.lt ?? '0';

    if (BigInt(prevLt) >= BigInt(id.lt)) return;

    this._lastTokenTransactions = {
      ...this._lastTokenTransactions,
      [owner]: {
        ...this._lastTokenTransactions[owner],
        [rootTokenContract]: id,
      },
    };

    chrome.storage.session.set({
      lastTokenTransactions: this._lastTokenTransactions,
    }).catch(console.error);
  }

  private _findNewTransactions(
    address: string,
    transactions: TonWalletTransaction[],
    info: TransactionsBatchInfo,
  ): TonWalletTransaction[] {
    const latestLt = BigInt(this._lastTransactions[address]?.lt ?? '0');

    if (info.batchType === 'new') return transactions;
    if (BigInt(info.maxLt) <= latestLt || latestLt === BigInt(0)) return []; // skip if no last transaction for this address

    return transactions.filter(({ id }) => BigInt(id.lt) > latestLt);
  }

  private _findNewTokenTransactions(
    owner: string,
    rootTokenContract: string,
    transactions: TokenWalletTransaction[],
    info: TransactionsBatchInfo,
  ): TokenWalletTransaction[] {
    const latestLt = BigInt(this._lastTokenTransactions[owner]?.[rootTokenContract]?.lt ?? '0');

    if (info.batchType === 'new') return transactions;
    if (BigInt(info.maxLt) <= latestLt || latestLt === BigInt(0)) return []; // skip if no last transaction for this address

    return transactions.filter(({ id }) => BigInt(id.lt) > latestLt);
  }
}

function requireTonWalletSubscription(
  address: string,
  subscription?: TonWalletSubscription,
): asserts subscription is TonWalletSubscription {
  if (!subscription) {
    throw new NekotonRpcError(
      RpcErrorCode.RESOURCE_UNAVAILABLE,
      `There is no subscription for address ${address}`,
    );
  }
}

function requireTokenWalletSubscription(
  address: string,
  rootTokenContract: string,
  subscription?: TokenWalletSubscription,
): asserts subscription is TokenWalletSubscription {
  if (!subscription) {
    throw new NekotonRpcError(
      RpcErrorCode.RESOURCE_UNAVAILABLE,
      `There is no token subscription for owner ${address}, root token contract ${rootTokenContract}`,
    );
  }
}
