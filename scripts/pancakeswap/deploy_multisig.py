from brownie import *

import json

def main():
    loadConfig()

    balanceBefore = acct.balance()
    # Function Call
    deployMultisig()
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

# == Multisig Deployment ======================================
def deployMultisig():
    owners = contracts["multisigOwners"]
    requiredConf = 1
    if network.show_active() == "mainnet":
        requiredConf = int(len(owners)/2 + 1)
    print("=============================================================")
    print("Deployment Parameters")
    print("=============================================================")
    print("Multisig Owners:         ", owners)
    print("Required Confirmations:  ", requiredConf)
    print("=============================================================")

    multisig = acct.deploy(MultiSigWallet, owners, requiredConf)
    print("=============================================================")
    print("Deployed Details")
    print("=============================================================")
    print("Multisig Address:        ", multisig)
    print("=============================================================")