from brownie import *

import json

def main():
    loadConfig()

    balanceBefore = acct.balance()
    # Function Call
    deploy_bSOV()
    balanceAfter = acct.balance()

    print("=============================================================")
    print("BNB Before Balance:  ", balanceBefore)
    print("BNB After Balance:   ", balanceAfter)
    print("Gas Used:            ", balanceBefore - balanceAfter)
    print("=============================================================")

def loadConfig():
    global contracts, acct
    thisNetwork = network.show_active()

    # == Load config ==============================================
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

# == bSOV Deployment ==========================================
def deploy_bSOV():
    tokenAmount = 10**26 # 100 Million Equivalent
    print("=============================================================")
    print("Deployment Parameters")
    print("=============================================================")
    print("Token Balance:   ", tokenAmount)
    print("=============================================================")

    bSOVtoken = acct.deploy(SOV, tokenAmount)
    tokenAmount = bSOVtoken.balanceOf(acct)
    print("=============================================================")
    print("Deployed Details")
    print("=============================================================")
    print("bSOV Address:  ", bSOVtoken)
    print("Token Balance: ", tokenAmount)
    print("=============================================================")