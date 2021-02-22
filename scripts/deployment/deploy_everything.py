#!/usr/bin/python3

from brownie import *
from scripts.deployment.deploy_protocol import deployProtocol
from scripts.deployment.deploy_loanToken import deployLoanTokens
from scripts.deployment.deploy_tokens import deployTokens, readTokens
from scripts.deployment.deploy_multisig import deployMultisig

import shared
import json
from munch import Munch

'''
Deploys all of the contracts.
1. deploys the tokens or reads exsiting token contracts.
    if configData contains token addresses, use the given addresses
    else, deploy new tokens
2. deploys the base protocol contracts.
3. deploys, configures and tests the loan token contracts.
4. writes the relevant contract addresses into swap_test.json.
'''
def main():
    global configData

    #owners = [accounts[0], accounts[1], accounts[2]]
    requiredConf=2
    configData = {} # deploy new tokens
    '''
    configData = {
        'WRBTC': '0x69FE5cEC81D5eF92600c1A0dB1F11986AB3758Ab',
        'SUSD': '0xCb46C0DdC60d18eFEB0e586c17AF6Ea36452DaE0',
        'mocOracleAddress': '0x2d39Cc54dc44FF27aD23A91a9B5fd750dae4B218'
    }
    '''

    thisNetwork = network.show_active()

    if thisNetwork == "development" or thisNetwork == "ganache":
        acct = accounts[0]
    elif thisNetwork == "testnet" or thisNetwork == "rsk-mainnet":
        acct = accounts.load("rskdeployer")
    else:
        raise Exception("network not supported")
    
    if('WRBTC' in configData and 'SUSD' in configData):
        tokens = readTokens(acct, configData['WRBTC'], configData['SUSD'])
    elif('SUSD' in configData):
        tokens = deployWRBTC(acct, configData['SUSD'])
    else:
        tokens = deployTokens(acct)
        
    if(not 'mocOracleAddress' in configData):
        mocOracle = deployMoCMockup(acct)
        configData['mocOracleAddress'] = mocOracle.address

    if(not 'rskOracleAddress' in configData):
        rskOracle = deployRSKMockup(acct)
        configData['rskOracleAddress'] = rskOracle.address

    if(not 'mocState' in configData):
        mocState = deployBProPriceFeedMockup(acct)
        configData['mocState'] = mocState.address
        
    (sovryn, feeds) = deployProtocol(acct, tokens, configData['mocOracleAddress'], configData['rskOracleAddress'])
    (loanTokenSUSD, loanTokenWRBTC, loanTokenSettingsSUSD,
     loanTokenSettingsWRBTC) = deployLoanTokens(acct, sovryn, tokens)

    #deployMultisig(sovryn, acct, owners, requiredConf)

    configData["sovrynProtocol"] = sovryn.address
    configData["PriceFeeds"] = feeds.address
    configData["WRBTC"] = tokens.wrbtc.address
    configData["SUSD"] = tokens.susd.address
    configData["loanTokenSUSD"] = loanTokenSUSD.address
    configData["loanTokenRBTC"] = loanTokenWRBTC.address

    with open('./scripts/swapTest/swap_test.json', 'w') as configFile:
        json.dump(configData, configFile)

def deployMoCMockup(acct):
    priceFeedsMoCMockup = acct.deploy(PriceFeedsMoCMockup)
    priceFeedsMoCMockup.setHas(True)
    priceFeedsMoCMockup.setValue(10000e18)
    return priceFeedsMoCMockup

def deployRSKMockup(acct):
    priceFeedRSKMockup = acct.deploy(PriceFeedRSKOracleMockup)
    priceFeedRSKMockup.setHas(True)
    priceFeedRSKMockup.setValue(10000e18)
    return priceFeedRSKMockup

def deployBProPriceFeedMockup(acct):
    bproPriceFeedMockup = acct.deploy(BProPriceFeedMockup)
    bproPriceFeedMockup.setValue(20000e18)
    return bproPriceFeedMockup