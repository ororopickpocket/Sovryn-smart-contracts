from brownie import *
from brownie.network.contract import InterfaceContainer
import json
import time;
import copy
from scripts.utils import * 
import scripts.contractInteraction.config as conf


def readLendingFee():
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    lfp = sovryn.lendingFeePercent()
    print(lfp/1e18)
    return lfp

def readLoan(loanId):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    print(sovryn.getLoan(loanId).dict())

def liquidate(protocolAddress, loanId):
    sovryn = Contract.from_abi("sovryn", address=protocolAddress, abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    loan = sovryn.getLoan(loanId).dict()
    print(loan)
    if(loan['maintenanceMargin'] > loan['currentMargin']):
        value = 0
        if(loan['loanToken']==conf.contracts['WRBTC']):
            value = loan['maxLiquidatable']
        else:
            testToken = Contract.from_abi("TestToken", address = loan['loanToken'], abi = TestToken.abi, owner = conf.acct)
            testToken.approve(sovryn, loan['maxLiquidatable'])
        sovryn.liquidate(loanId, conf.acct, loan['maxLiquidatable'],{'value': value})
    else:
        print("can't liquidate because the loan is healthy")
    
   
def rollover(loanId):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    tx = sovryn.rollover(loanId, b'')
    print(tx.info())

def replaceLoanClosings():
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)

    print('replacing loan closings base')
    loanClosingsBase = conf.acct.deploy(LoanClosingsBase)
    data = sovryn.replaceContract.encode_input(loanClosingsBase.address)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

    print('replacing loan closings with')
    loanClosingsWith = conf.acct.deploy(LoanClosingsWith)
    data = sovryn.replaceContract.encode_input(loanClosingsWith.address)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def replaceSwapsExternal():
    swapsExternal = conf.acct.deploy(SwapsExternal)
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.replaceContract.encode_input(swapsExternal.address)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def replaceLoanOpenings():
    print("replacing loan openings")
    loanOpenings = conf.acct.deploy(LoanOpenings)
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.replaceContract.encode_input(loanOpenings.address)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def replaceSwapsImplSovrynSwap():
    print("replacing swaps")
    swaps = conf.acct.deploy(SwapsImplSovrynSwap)
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setSwapsImplContract.encode_input(swaps.address)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def setLendingFee(fee):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setLendingFeePercent.encode_input(fee)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def setTradingFee(fee):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setTradingFeePercent.encode_input(fee)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def setBorrowingFee(fee):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setBorrowingFeePercent.encode_input(fee)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def setAffiliateFeePercent(fee):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setAffiliateFeePercent.encode_input(fee)
    print('sovryn.setAffiliateFeePercent for', fee, ' tx:')
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def setAffiliateTradingTokenFeePercent(percentFee):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setAffiliateTradingTokenFeePercent.encode_input(percentFee)
    print('sovryn.setAffiliateTradingTokenFeePercent for ', percentFee, ' tx:')
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)


def setMinReferralsToPayout(minReferrals):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setMinReferralsToPayoutAffiliates.encode_input(minReferrals)
    print('setMinReferralsToPayoutAffiliates set to ', minReferrals, ' tx:')
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def replaceProtocolSettings():
    print("Deploying ProtocolSettings.")
    settings = conf.acct.deploy(ProtocolSettings)

    print("Calling replaceContract.")
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.replaceContract.encode_input(settings.address)
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def replaceLoanSettings():
    print("Deploying LoanSettings.")
    settings = conf.acct.deploy(LoanSettings)

    print("Calling replaceContract.")
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.replaceContract.encode_input(settings.address)
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def deployAffiliate():
    #loadConfig() - called from main()
    # -------------------------------- 1. Replace the protocol settings contract ------------------------------
    #replaceProtocolSettings() - called from main()

    # -------------------------------- 2. Deploy the affiliates -----------------------------------------------
    affiliates = conf.acct.deploy(Affiliates)
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.replaceContract.encode_input(affiliates.address)
    print('affiliates deployed. data:')
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

    # Set protocolAddress
    data = sovryn.setSovrynProtocolAddress.encode_input(sovryn.address)
    print("Set Protocol Address in protocol settings")
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)
    print("protocol address loaded") #, sovryn.getProtocolAddress()) - not executed yet

    # Set SOVTokenAddress
    sovToken = Contract.from_abi("SOV", address=conf.contracts["SOV"], abi=SOV.abi, owner=conf.acct)
    data = sovryn.setSOVTokenAddress.encode_input(sovToken.address)
    # data = sovryn.setSOVTokenAddress.encode_input(conf.contracts["SOV"])
    print("Set SOV Token address in protocol settings")
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)
    print("sovToken address loaded") #, sovryn.getSovTokenAddress()) - not executed yet

    # Set LockedSOVAddress
    lockedSOV = Contract.from_abi("LockedSOV", address=conf.contracts["LockedSOV"], abi=LockedSOV.abi, owner=conf.acct)
    data = sovryn.setLockedSOVAddress.encode_input(lockedSOV.address)
    print("Set Locked SOV address in protocol settings")
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)
    print("lockedSOV address loaded:", lockedSOV.address)

    # Set minReferralsToPayout
    setMinReferralsToPayout(3)

    # Set affiliateTradingTokenFeePercent
    setAffiliateTradingTokenFeePercent(20 * 10**18)

    # Set affiliateFeePercent
    setAffiliateFeePercent(5 * 10**18)

    # ---------------------------- 3. Redeploy modules which implement InterestUser and SwapsUser -----------------------
    # LoanClosingsBase
    # LoanClosingsWith
    replaceLoanClosings()
    # LoanOpenings
    replaceLoanOpenings()
    # LoanMaintenance
    replaceLoanMaintenance()
    # SwapsExternal
    redeploySwapsExternal()
    # LoanSettings()
    replaceLoanSettings()

    # -------------------------------- 4. Replace Token Logic Standard ----------------------------------------
    replaceLoanTokenLogicOnAllContracts()

def replaceLoanMaintenance():
    print("replacing loan maintenance")
    loanMaintenance = conf.acct.deploy(LoanMaintenance)
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.replaceContract.encode_input(loanMaintenance.address)
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def redeploySwapsExternal():
    print('replacing swaps external')
    swapsExternal = conf.acct.deploy(SwapsExternal)
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.replaceContract.encode_input(swapsExternal.address)
    print(data)

    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

# feesControllerAddress = new feeSharingProxy address
def setFeesController(feesControllerAddress):
    print("Set up new fees controller")
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setFeesController.encode_input(feesControllerAddress)
    print(data)
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def readMaxAffiliateFee():
    abiFile =  open('./scripts/contractInteraction/ABIs/SovrynSwapNetwork.json')
    abi = json.load(abiFile)
    swapNetwork = Contract.from_abi("SovrynSwapNetwork", address=conf.contracts['swapNetwork'], abi=abi, owner=conf.acct)
    print(swapNetwork.maxAffiliateFee())

def withdrawFees():
    feeSharingProxy = Contract.from_abi("FeeSharingProxy", address=conf.contracts['FeeSharingProxy'], abi=FeeSharingProxy.abi, owner=conf.acct)
    feeSharingProxy.withdrawFees(conf.contracts['USDT'])
    feeSharingProxy.withdrawFees(conf.contracts['DoC'])
    feeSharingProxy.withdrawFees(conf.contracts['WRBTC'])

def setSupportedToken(tokenAddress):
    sovryn = Contract.from_abi("sovryn", address=conf.contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=conf.acct)
    data = sovryn.setSupportedTokens.encode_input([tokenAddress],[True])
    sendWithMultisig(conf.contracts['multisig'], sovryn.address, data, conf.acct)

def deployConversionFeeSharingToWRBTC():
    print("Redeploy fee sharing proxy")
    # Redeploy feeSharingProxy
    feeSharing = conf.acct.deploy(FeeSharingProxy, conf.contracts['sovrynProtocol'], conf.contracts['Staking'], conf.contracts["WRBTC"])
    print("Fee sharing proxy redeployed at: ", feeSharing.address)

    # Redeploy protocol settings
    replaceProtocolSettings()

    # Redeploy swaps external
    redeploySwapsExternal()

    # Set Fees Controller
    setFeesController(feeSharing.address)