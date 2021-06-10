from brownie import *
from brownie.network.contract import InterfaceContainer
import time
import json
import sys

def main():
    loadConfig()

    balanceBefore = acct.balance()
    # Function Call
    deployPool(10e18, 500e18)
    # deployPool(.1e18, 5e18) # testnet settings (mainet settings are too high for a regular faucet interaction).
    balanceAfter = acct.balance()

    print("=============================================================")
    print("BNB Before Balance:  ", balanceBefore)
    print("BNB After Balance:   ", balanceAfter)
    print("Gas Used:            ", balanceBefore - balanceAfter)
    print("=============================================================")

def loadConfig():
    global contracts, acct
    thisNetwork = network.show_active()

    # == Load config =======================================================================================================================
    if thisNetwork == "binance-testnet":
        acct = accounts.load("rskdeployer")
        configFile =  open('./scripts/pancakeswap/bsc_testnet_contracts.json')
    elif thisNetwork == "binance-mainnet":
        acct = accounts.load("rskdeployer")
        configFile =  open('./scripts/pancakeswap/bsc_mainnet_contracts.json')
    else:
        raise Exception("Network not supported.")

    # Load deployed contracts addresses
    contracts = json.load(configFile)

# == PancakeSwap Pool Deployment ==================================
def deployPool(bnbAmount, bSOVAmount):
    bSOV = Contract.from_abi("SOV", address = contracts['bSOV'], abi = SOV.abi, owner = acct)    
    pancakeRouter02 = Contract.from_abi("IPancakeRouter02", address=contracts['PancakeRouter02'], abi=interface.IPancakeRouter02.abi, owner=acct)

    # Checks if user has approved PancakeSwap for transfer. If not, will do the transfer.
    checkTokenApproval(bSOV, acct, pancakeRouter02.address, bSOVAmount)
    
    # Creating PancakeSwap Pool
    thirtyMinutes = 30 * 60
    currentTimestamp = int(time.time())
    deadline = currentTimestamp + thirtyMinutes
    # https://github.com/pancakeswap/pancake-swap-periphery/blob/master/contracts/PancakeRouter.sol#L61
    print("=============================================================")
    print("Interaction Parameters (Pool Creation)")
    print("=============================================================")
    print("bSOV Token:                  ", bSOV.address)
    print("amountTokenDesired:          ", bSOVAmount)
    print("amountTokenMin:              ", bSOVAmount)
    print("amountBNBMin:                ", bnbAmount)
    print("to:                          ", acct)
    print("deadline:                    ", deadline)
    print("=============================================================")
    print("Current Timestamp:           ", currentTimestamp)
    print("=============================================================")
    tx = pancakeRouter02.addLiquidityETH(bSOV.address, bSOVAmount, bSOVAmount, bnbAmount, acct, deadline, { 'value': bnbAmount })
    tx.info()

def checkTokenApproval(token, owner, spender, amount):
    if(token.allowance(owner, spender) < amount):
        # Approving token transfer.
        print("=============================================================")
        print("Interaction Parameters (Token Transfer Approval)")
        print("=============================================================")
        print("Spender Address:             ", spender)
        print("Amount approved:             ", amount)
        print("=============================================================")
        tx = token.approve(spender, amount)
        tx.info()
