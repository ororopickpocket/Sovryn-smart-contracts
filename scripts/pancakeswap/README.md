# PancakeSwap Pool Creation

## Files:

### deploy_test_bSOV

Creates a sample SOV token in the network you choose with 100 Million tokens.

### deploy_multisig

Creates a sample multisig using [`MultisigWallet.sol`](../../contracts/multisig/MultiSigWallet.sol)

The multisig owners are taken from either [`bsc_testnet_contracts.json`](./bsc_testnet_contracts.json) or [`bsc_mainnet_contracts.json`](./bsc_mainnet_contracts.json) depending on the network.

In testnet, required confirmations from admins are 1 while in mainnet, it is 2.

### deploy_pool_user

Creates a pool from an EOA (Externally Owned Account) in PancakeSwap.

It assumes that you have enough BNB & token balance for the liquidity in the wallet calling this function.

It checks if the token is approved to be spent by the PancakeSwap, if not, it will do that.

It then creates the pool in PancakeSwap.

### deploy_pool

Creates a pool from a multisig in PancakeSwap.

It assumes either multisig or the user (EOA) calling it has enough BNB and Token in balance.

It checks if the multisig has enough BNB balance, if not it takes the required BNB from EOA.

It then checks if the multisig has enough Token balance, if not, it takes the required Token from EOA.

It then checks if the token is approved to be spent by the PancakeSwap, if not, it will do that.

It then creates a pool from multisig. (A transaction in multisig is created.)

If checking on testnet, these steps will create the pool. If on mainnet, another user has to call the confirm transaction.

## Steps to Create Pool:

NOTE: Dev experience advised to run the script and to make some edits suggested.


### Brownie Configuration for Binance Network

Add new BSC networks to brownie:

```
brownie networks add "BSC" "binance-mainnet" host="https://bsc​-dataseed1.defibit.io/" chainid=56
```

```
brownie networks add "BSC" "binance-testnet" host="https://data-seed-prebsc-1-s1.binance.org:8545/" chainid=97
```

### Mainnet

1. Go to [`bsc_mainnet_contracts.json`](./bsc_mainnet_contracts.json) and add the values for Multisig Admins. (NOTE: PancakeRouter02 is taken from [OpenZeppeling Forum](https://forum.openzeppelin.com/t/psa-regarding-safemoon-forks-on-pancakeswap-transfers-not-working-read-this/7692) and bSOV is taken from [Sovryn Wiki](https://wiki.sovryn.app/en/technical-documents/mainnet-contract-addresses). Please don't change it unless you know what you are doing.)

2. Go to [`brownie-config.yaml`](../../brownie-config.yaml) and edit the `gas_price` under `networks > live` to the current average or fast gas price for BSC network. Binance average is somewhere near [`20 Gwei`](https://bscscan.com/chart/gasprice).

3. (Optional) Deploying MultiSig: If you don't have a multisig yet, please use the [`deploy_multisig.py`](./deploy_multisig.py) to create a multisig with the parameters taken from [`bsc_mainnet_contracts.json`](./bsc_mainnet_contracts.json). To create, please run the following command:

```
brownie run scripts/pancakeswap/deploy_multisig.py --network binance-mainnet
```

4. Once multisig is deployed or known, please update [`bsc_mainnet_contracts.json`](./bsc_mainnet_contracts.json) to add the new multisig address.

5. Deploying Pool: Create a new pool using [`deploy_pool.py`](./deploy_pool.py). To create, please run the following command:

```
brownie run scripts/pancakeswap/deploy_pool.py --network binance-mainnet
```

### Testnet

1. Go to [`bsc_testnet_contracts.json`](./bsc_testnet_contracts.json) and add the values for Multisig Admins. (NOTE: PancakeRouter02 is taken from [PancakeSwap's Twitter Feed](https://twitter.com/pancakeswap/status/1369547285160370182?lang=en). Please don't change it unless you know what you are doing.)

2. Go to [`brownie-config.yaml`](../../brownie-config.yaml) and edit the `gas_price` under `networks > live` to the current average or fast gas price for BSC network.

3. (Optional) Deploying bSOV: If you don't have a bSOV Token yet, please use the [`deploy_test_bSOV.py`](./deploy_test_bSOV.py) to create a bSOV Token with 100 Million as Token Initial Supply. To create, please run the following command:

```
brownie run scripts/pancakeswap/deploy_test_bSOV.py --network binance-testnet
```

4. Once bSOV is deployed or known, please update [`bsc_testnet_contracts.json`](./bsc_testnet_contracts.json) to add the new bSOV Token address.

5. (Optional) Deploying MultiSig: If you don't have a multisig yet, please use the [`deploy_multisig.py`](./deploy_multisig.py) to create a multisig with the parameters taken from [`bsc_testnet_contracts.json`](./bsc_testnet_contracts.json). To create, please run the following command:

```
brownie run scripts/pancakeswap/deploy_multisig.py --network binance-testnet
```

6. Once multisig is deployed or known, please update [`bsc_testnet_contracts.json`](./bsc_testnet_contracts.json) to add the new multisig address.

7. Deploying Pool: Create a new pool using [`deploy_pool.py`](./deploy_pool.py). To create, please run the following command:

```
brownie run scripts/pancakeswap/deploy_pool.py --network binance-testnet
```

NOTE: If you want to create a pool with EOA, use [`deploy_pool_user.py`](./deploy_pool_user.py). This does not require multisig deployment.

## Possible Errors:

1. Please don't forget to set end points (RPC) for brownie networks (`binance-mainnet` and `binance-testnet`). Use your own full node, or any provider like [BSC RPC Endpoints](https://docs.binance.org/smart-chain/developer/rpc.html).

2. If the multisig does not have enough tokens or BNB to provide liquidity, it is taken from the account which is running it. Please make sure you have enough liquidity present in either your account or multisig.

The deploy script w/ no multisig (`deploy_pool_user.py`) and also the multisign script (`deploy_pool.py`) on line 12 has a default configuration values for the amount of BNB and bSOV to spend when deploying the pool:

```
    # deployPool(10e18, 500e18) ## previous settings probably right for mainet, but too high for a regular faucet interaction on testnet.
    deployPool(.1e18, 5e18)
```

So, be sure to set these values properly on mainnet before running the scripts.
