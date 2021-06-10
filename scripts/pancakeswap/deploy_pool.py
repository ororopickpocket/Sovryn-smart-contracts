from brownie import *
from brownie.network.contract import InterfaceContainer
import time
import json
import sys

def main():
    loadConfig()

    balanceBefore = acct.balance()
    # Function Call
    # tokenTransfer(contracts['multisig'], bSOVAmount) # Change bSOVAmount with the amount of bSOV to be transferred.
    deployPoolFromMultisig(10e18, 500e18)
    # deployPoolFromMultisig(.1e10, 5e10) # testnet settings (mainet settings are too high for a regular faucet interaction).
    # confirmTransaction() # Need to add a transaction ID as parameter.
    # executeOnMultisig() # Need to add a transaction ID as parameter.
    balanceAfter = acct.balance()

    print("=============================================================")
    print("BNB Before Balance:  ", balanceBefore)
    print("BNB After Balance:   ", balanceAfter)
    print("Gas Used:            ", balanceBefore - balanceAfter)
    print("=============================================================")

def loadConfig():
    global contracts, acct
    thisNetwork = network.show_active()

    ### IMPORTANT! rskdeployer account should be the same as multisig's owner1

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
def deployPoolFromMultisig(bnbAmount, bSOVAmount):
    bSOV = Contract.from_abi("SOV", address = contracts['bSOV'], abi = SOV.abi, owner = acct)
    bscMultisig = Contract.from_abi("MultiSig", address=contracts['bscMultisig'], abi=MultiSigWallet.abi, owner=acct)
    pancakeRouter02 = Contract.from_abi("IPancakeRouter02", address=contracts['PancakeRouter02'], abi=interface.IPancakeRouter02.abi, owner=acct)

    # Checks if multisig has enough BNB balance. If not enough, will transfer in case of test network.
    checkBnbBalanceAndTransfer(bscMultisig, bnbAmount)

    # Checks if multisig has enough token balance. If not enough, will transfer in case of test network.
    checkTokenBalanceAndTransfer(bSOV, bscMultisig.address, bSOVAmount)

    # Checks if multisig has approved PancakeSwap for transfer. If not, will do the transfer.
    checkTokenApprovalInMultisig(bSOV, bscMultisig.address, pancakeRouter02.address, bSOVAmount)
    
    # Creating PancakeSwap Pool
    thirtyMinutes = 30 * 60
    currentTimestamp = int(time.time())
    deadline = currentTimestamp + thirtyMinutes
    data = pancakeRouter02.addLiquidityETH.encode_input(bSOV.address, bSOVAmount, bSOVAmount, bnbAmount, bscMultisig.address, deadline)
    # https://github.com/pancakeswap/pancake-swap-periphery/blob/master/contracts/PancakeRouter.sol#L61
    print("=============================================================")
    print("Interaction Parameters (Pool Creation)")
    print("=============================================================")
    print("bSOV Token:                  ", bSOV.address)
    print("amountTokenDesired:          ", bSOVAmount)
    print("amountTokenMin:              ", bSOVAmount)
    print("amountBNBMin:                ", bnbAmount)
    print("to:                          ", bscMultisig.address)
    print("deadline:                    ", deadline)
    print("Encoded Data:                ", data)
    print("=============================================================")
    print("Current Timestamp:           ", currentTimestamp)
    print("=============================================================")
    submitTransaction(pancakeRouter02.address, bnbAmount, data)

# Checks if enough balance is there in a receiver, if not, will transfer the difference.
def checkBnbBalanceAndTransfer(receiver, bnbAmount):
    bal = receiver.balance()
    if(bal < bnbAmount):
        if network.show_active() == "binance-testnet":
            acct.transfer(receiver.address, bnbAmount - bal)
        else:
            print("Not enough BNB balance in address.")
            sys.exit()

# Just a function to take out BNB from multisig.
def bnbTransferOutFromMultisig(receiver, bnbAmount):
    submitTransaction(receiver, bnbAmount, '0x')

# Checks user token balance, and if not enough balance, will either quit the program (mainnet) or replenish (testnet)
def checkTokenBalanceAndTransfer(token, addr, amount):
    addrBalance = token.balanceOf(addr)
    if(addrBalance < amount):
        if network.show_active() == "binance-testnet":
            tokenTransfer(addr, amount)
        else:
            print("Not enough token balance in address.")
            sys.exit()

# Makes the token transfer to `receiver` for the amount of `bSOVAmount`.
def tokenTransfer(receiver, bSOVAmount):
    bSOV = Contract.from_abi("SOV", address = contracts['bSOV'], abi = SOV.abi, owner = acct)
    print("=============================================================")
    print("Interaction Parameters (Token Transfer)")
    print("=============================================================")
    print("Receiver:                ", receiver)
    print("bSOV Amount:             ", bSOVAmount)
    print("=============================================================")
    tx = bSOV.transfer(receiver, bSOVAmount)
    tx.info()

# Checks if enough token approval is there in spender from owner. If not, it will make the allowance. This one is made for multisig.
def checkTokenApprovalInMultisig(token, owner, spender, amount):
    if(token.allowance(owner, spender) < amount):
        # Approving token transfer.
        data = token.approve.encode_input(spender, amount)
        print("=============================================================")
        print("Interaction Parameters (Token Transfer Approval)")
        print("=============================================================")
        print("Spender Address:             ", spender)
        print("Amount approved:             ", amount)
        print("Encoded Data:                ", data)
        print("=============================================================")
        submitTransaction(token.address, 0, data)

# Submits the transaction in multisig.
def submitTransaction(target, value, data):
    bscMultisig = Contract.from_abi("MultiSig", address=contracts['bscMultisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = bscMultisig.submitTransaction(target, value, data)
    txId = tx.events["Submission"]["transactionId"]
    print("=============================================================")
    print("Return Parameters (Multisig Submission)")
    print("=============================================================")
    print("Transaction ID:          ", txId)
    print("=============================================================")
    tx.info()

# Confirm the transaction in multisig.
def confirmTransaction(transactionId):
    bscMultisig = Contract.from_abi("MultiSig", address=contracts['bscMultisig'], abi=MultiSigWallet.abi, owner=acct)
    print("=============================================================")
    print("Interaction Parameters (Multisig Confirmation)")
    print("=============================================================")
    print("Transaction ID:          ", transactionId)
    print("=============================================================")
    tx = bscMultisig.confirmTransaction(transactionId)
    tx.info()

# Execute the transaction in multisig.
def executeOnMultisig(transactionId):
    multisig = Contract.from_abi("MultiSig", address=contracts['bscMultisig'], abi=MultiSigWallet.abi, owner=acct)
    print("=============================================================")
    print("Interaction Parameters (Multisig Execution)")
    print("=============================================================")
    print("Transaction ID:          ", transactionId)
    print("=============================================================")
    tx = multisig.executeTransaction(transactionId)
    tx.info()
