
'''
This script serves the purpose of interacting with existing smart contracts on the testnet or mainnet.
'''

from brownie import *
from brownie.network.contract import InterfaceContainer
import json
import time;
import copy

def main():
    
    #load the contracts and acct depending on the network
    loadConfig()
    #call the function you want here
    #setupMarginLoanParams(contracts['WRBTC'], contracts['iDOC'])
    #readPrice(contracts['WRBTC'], contracts['USDT'])
    # testTradeOpeningAndClosingWithCollateral(contracts['sovrynProtocol'], contracts['iUSDT'], contracts['USDT'], contracts['WRBTC'], 1e14, 2e18, True, 1e14)
    #setupMarginLoanParams(contracts['DoC'],  contracts['iRBTC'])
    #testTradeOpeningAndClosing(contracts['sovrynProtocol'], contracts['iRBTC'], contracts['WRBTC'], contracts['DoC'], 1e14, 5e18, True, 1e15)
    #buyWRBTC()
    #swapTokens(0.027e18,400e18, contracts['swapNetwork'], contracts['WRBTC'], contracts['USDT'])
    #swapTokens(300e18, 0.02e18, contracts['swapNetwork'], contracts['DoC'], contracts['WRBTC'])
    #liquidate(contracts['sovrynProtocol'], '0xc9b8227bcf953e45f16d5d9a8a74cad92f403b90d0daf00900bb02e4a35c542c')
    #readLiquidity()
    #getBalance(contracts['WRBTC'], '0xE5646fEAf7f728C12EcB34D14b4396Ab94174827')
    #getBalance(contracts['WRBTC'], '0x7BE508451Cd748Ba55dcBE75c8067f9420909b49')
    #readLoan('0xb2bbd9135a7cfbc5adda48e90430923108ad6358418b7ac27c9edcf2d44911e5')
    #replaceLoanClosings()

    #updateAllLogicContracts()
    #readOwner(contracts['iDOC'])
    #readTransactionLimits(contracts['iDOC'],  contracts['DoC'],  contracts['WRBTC'])
    #setTransactionLimits(contracts['iDOC'], [contracts['DoC'],  contracts['WRBTC']], [0, 0])
    #setTransactionLimits(contracts['iRBTC'], [contracts['DoC'],  contracts['WRBTC']], [0, 0])
    #setTransactionLimitsOld(contracts['iDOC'], contracts['iDOCSettings'], contracts['iDOCLogic'], [contracts['DoC']], [0])
    #lendToPool(contracts['iDOC'],contracts['DoC'], 1000e18)
    #setTransactionLimits(contracts['iDOC'], [contracts['DoC']], [21e18])
    #setTransactionLimitsOld(contracts['iDOC'], contracts['iDOCSettings'], contracts['iDOCLogic'], [contracts['DoC']], [21e18])
    #readTransactionLimits(contracts['iDOC'],  contracts['DoC'], contracts['WRBTC'])


    #setupLoanParamsForCollaterals(contracts['iBPro'], [contracts['DoC'], contracts['USDT']])
    #setupLoanParamsForCollaterals(contracts['iDOC'], [contracts['BPro'], contracts['USDT']])
    #setupLoanParamsForCollaterals(contracts['iUSDT'], [contracts['DoC'], contracts['BPro']])
    #setupLoanParamsForCollaterals(contracts['iRBTC'], [contracts['BPro'], contracts['USDT']])

    #deployMultisig(['0xdB3DB4c5695f2aab0F406C86d1f35D326685d055', '0x5092019A3E0334586273A21a701F1BD859ECAbD6', '0xD6da34D91fC59134A132b17e7b5a472CA1BeA794'], 2)
    #deployMultisig(['0x2bD2201bfe156a71EB0d02837172FFc237218505', acct, '0xdB3DB4c5695f2aab0F406C86d1f35D326685d055', '0x5092019A3E0334586273A21a701F1BD859ECAbD6', '0xD6da34D91fC59134A132b17e7b5a472CA1BeA794'], 2)
    #updatePriceFeedToRSKOracle()
    #checkRates()

    #checkOwnerIsAddress(contracts['sovrynProtocol'], contracts['multisig'])

    '''
    print("price feeds SOV")
    transferOwner(contracts['PriceFeedRSKOracle'], contracts['multisig'])
    transferOwner(contracts['USDTPriceFeed'], contracts['multisig'])
    
    
    print("price feeds AMM")
    transferOwner('0xe4d2e26ce947df7a8d04e5a9dcdef0c540c497cf', contracts['multisig'])#BPRO
    transferOwner('0x4106e4Bb0C339cf7e8adc64Cf889F261Fef1e789', contracts['multisig'])#WRBTC
    transferOwner('0xf5df3b2ae0c4e2c8912e177f6bd8ca6d479397a2', contracts['multisig'])#USD
    
    
    print("loan tokens")
    #transferOwner(contracts['iUSDT'], contracts['multisig'])
    #transferOwner(contracts['iBPro'], contracts['multisig'])
    #transferOwner(contracts['iDOC'], contracts['multisig'])
    transferOwner(contracts['iRBTC'], contracts['multisig'])
    
    print("AMM Network + Converters")
    transferOwner(contracts['swapNetwork'], contracts['multisig'])
    transferOwner(contracts['ConverterDOC'], contracts['multisig'])
    transferOwner(contracts['ConverterBPRO'], contracts['multisig'])
    transferOwner(contracts['ConverterUSDT'], contracts['multisig'])
    #note:the ownership transfers for the AMM need to be accepted by the new owner
    
    
    acceptOwnershipWithMultisig(contracts['swapNetwork'])
    acceptOwnershipWithMultisig(contracts['ConverterDOC'])
    acceptOwnershipWithMultisig(contracts['ConverterBPRO'])
    acceptOwnershipWithMultisig(contracts['ConverterUSDT'])
    acceptOwnershipWithMultisig('0xe4d2e26ce947df7a8d04e5a9dcdef0c540c497cf')
    acceptOwnershipWithMultisig('0x4106e4Bb0C339cf7e8adc64Cf889F261Fef1e789')
    
    checkOwnerIsAddress(contracts['swapNetwork'], contracts['multisig'])
    checkOwnerIsAddress(contracts['ConverterDOC'], contracts['multisig'])
    checkOwnerIsAddress(contracts['ConverterBPRO'], contracts['multisig'])
    checkOwnerIsAddress(contracts['ConverterUSDT'], contracts['multisig'])
    checkOwnerIsAddress('0xe4d2e26ce947df7a8d04e5a9dcdef0c540c497cf', contracts['multisig'])
    checkOwnerIsAddress('0x4106e4Bb0C339cf7e8adc64Cf889F261Fef1e789', contracts['multisig'])
    '''

    #addOwnerToMultisig('0x27d55f5668ef4438635bdce0adca083507e77752')

    #readLiquidity()
    #swapTokens(1e18, 1, contracts['swapNetwork'], contracts['USDT'], contracts['BPro'])
    #readFromMedianizer()
    #replaceSwapsUser()
    #checkRates()
    #replaceSwapsExternal()

    # governorAcceptAdmin("governorOwner")
    # governorAcceptAdmin("governorAdmin")

    #replaceLoanTokenLogicOnAllContracts()

    # setEarlyAccessToken(contracts['iDOC'], contracts['og'])
    # setEarlyAccessToken(contracts['iUSDT'], contracts['og'])
    # setEarlyAccessToken(contracts['iRBTC'], contracts['og'])
    # setEarlyAccessToken(contracts['iBPro'], contracts['og'])

    createProposalSIP005()

def loadConfig():
    global contracts, acct
    this_network = network.show_active()
    if this_network == "rsk-mainnet":
        configFile =  open('./scripts/contractInteraction/mainnet_contracts.json')
    elif this_network == "testnet":
        configFile =  open('./scripts/contractInteraction/testnet_contracts.json')
    contracts = json.load(configFile)
    acct = accounts.load("rskdeployer")
    


    
def readLendingFee():
    sovryn = Contract.from_abi("sovryn", address='0xBAC609F5C8bb796Fa5A31002f12aaF24B7c35818', abi=interface.ISovrynBrownie.abi, owner=acct)
    lfp = sovryn.lendingFeePercent()
    print(lfp/1e18)
    
def setupLoanTokenRates(loanTokenAddress):
    baseRate = 1e18
    rateMultiplier = 20.25e18
    targetLevel=80*10**18
    kinkLevel=90*10**18
    maxScaleRate=100*10**18
    localLoanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    localLoanToken.setDemandCurve(baseRate,rateMultiplier,baseRate,rateMultiplier, targetLevel, kinkLevel, maxScaleRate)
    borrowInterestRate = localLoanToken.borrowInterestRate()
    print("borrowInterestRate: ",borrowInterestRate)
    
def lendToPool(loanTokenAddress, tokenAddress, amount):
    token = Contract.from_abi("TestToken", address = tokenAddress, abi = TestToken.abi, owner = acct)
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    if(token.allowance(acct, loanToken.address) < amount):
        token.approve(loanToken.address, amount)
    loanToken.mint(acct, amount)
    
def removeFromPool(loanTokenAddress, amount):
    loanToken = Contract.from_abi("loanToken", address = loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    loanToken.burn(acct, amount)

def readLoanTokenState(loanTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    tas = loanToken.totalAssetSupply()
    print("total supply", tas/1e18);
    #print((balance - tas)/1e18)
    tab = loanToken.totalAssetBorrow()
    print("total asset borrowed", tab/1e18)
    abir = loanToken.avgBorrowInterestRate()
    print("average borrow interest rate", abir/1e18)
    ir = loanToken.nextSupplyInterestRate(0)
    print("next supply interest rate", ir)
    bir = loanToken.nextBorrowInterestRate(0)
    print("next borrow interest rate", bir)
    
def readLoan(loanId):
    sovryn = Contract.from_abi("sovryn", address=contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=acct)
    print(sovryn.getLoan(loanId).dict())

def getTokenPrice(loanTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    price = loanToken.tokenPrice()
    print("token price",price)
    return price
    
def testTokenBurning(loanTokenAddress, testTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    testToken = Contract.from_abi("TestToken", address = testTokenAddress, abi = TestToken.abi, owner = acct)

    testToken.approve(loanToken,1e17) 
    loanToken.mint(acct, 1e17)
    balance = loanToken.balanceOf(acct)
    print("balance", balance)
    tokenPrice = loanToken.tokenPrice()
    print("token price",tokenPrice/1e18)
    burnAmount = int(balance / 2)
    print("burn amount", burnAmount)
    
    tx = loanToken.burn(acct, burnAmount)
    print(tx.info())
    balance = loanToken.balanceOf(acct)
    print("remaining balance", balance/1e18)
    assert(tx.events["Burn"]["tokenAmount"] == burnAmount)
    
def liquidate(protocolAddress, loanId):
    sovryn = Contract.from_abi("sovryn", address=protocolAddress, abi=interface.ISovrynBrownie.abi, owner=acct)
    loan = sovryn.getLoan(loanId).dict()
    print(loan)
    if(loan['maintenanceMargin'] > loan['currentMargin']):
        value = 0
        if(loan['loanToken']==contracts['WRBTC']):
            value = loan['maxLiquidatable']
        else:
            testToken = Contract.from_abi("TestToken", address = loan['loanToken'], abi = TestToken.abi, owner = acct)
            testToken.approve(sovryn, loan['maxLiquidatable'])
        sovryn.liquidate(loanId, acct, loan['maxLiquidatable'],{'value': value})
    else:
        print("can't liquidate because the loan is healthy")
    
def testTradeOpeningAndClosing(protocolAddress, loanTokenAddress, underlyingTokenAddress, collateralTokenAddress, loanTokenSent, leverage, testClose, sendValue):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    testToken = Contract.from_abi("TestToken", address = underlyingTokenAddress, abi = TestToken.abi, owner = acct)
    sovryn = Contract.from_abi("sovryn", address=protocolAddress, abi=interface.ISovrynBrownie.abi, owner=acct)
    if(sendValue == 0 and testToken.allowance(acct, loanTokenAddress) < loanTokenSent):
        testToken.approve(loanToken, loanTokenSent)
    print('going to trade')
    tx = loanToken.marginTrade(
        "0",  # loanId  (0 for new loans)
        leverage,  # leverageAmount, 18 decimals
        loanTokenSent,  # loanTokenSent
        0,  # no collateral token sent
        collateralTokenAddress,  # collateralTokenAddress
        acct,  # trader,
        b'',  # loanDataBytes (only required with ether)
        {'value': sendValue}
    )
    tx.info()
    loanId = tx.events['Trade']['loanId']
    collateral = tx.events['Trade']['positionSize']
    print("closing loan with id", loanId)
    print("position size is ", collateral)
    loan = sovryn.getLoan(loanId)
    print("found the loan in storage with position size", loan['collateral'])
    print(loan)
    if(testClose):
        tx = sovryn.closeWithSwap(loanId, acct, collateral, True, b'')

def testTradeOpeningAndClosingWithCollateral(protocolAddress, loanTokenAddress, underlyingTokenAddress, collateralTokenAddress, collateralTokenSent, leverage, testClose, sendValue):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    testToken = Contract.from_abi("TestToken", address = underlyingTokenAddress, abi = TestToken.abi, owner = acct)
    sovryn = Contract.from_abi("sovryn", address=protocolAddress, abi=interface.ISovrynBrownie.abi, owner=acct)
    #if(sendValue == 0 and testToken.allowance(acct, loanTokenAddress) < loanTokenSent):
    #    testToken.approve(loanToken, loanTokenSent)
    print('going to trade')
    tx = loanToken.marginTrade(
        "0",  # loanId  (0 for new loans)
        leverage,  # leverageAmount, 18 decimals
        0,  # loanTokenSent
        collateralTokenSent,  # no collateral token sent
        collateralTokenAddress,  # collateralTokenAddress
        acct,  # trader,
        b'',  # loanDataBytes (only required with ether)
        {'value': sendValue}
    )
    tx.info()
    loanId = tx.events['Trade']['loanId']
    collateral = tx.events['Trade']['positionSize']
    print("closing loan with id", loanId)
    print("position size is ", collateral)
    loan = sovryn.getLoan(loanId)
    print("found the loan in storage with position size", loan['collateral'])
    print(loan)
    if(testClose):
        tx = sovryn.closeWithSwap(loanId, acct, collateral, True, b'')



def testBorrow(protocolAddress, loanTokenAddress, underlyingTokenAddress, collateralTokenAddress):
    #read contract abis
    sovryn = Contract.from_abi("sovryn", address=protocolAddress, abi=interface.ISovrynBrownie.abi, owner=acct)
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    testToken = Contract.from_abi("TestToken", address = collateralTokenAddress, abi = TestToken.abi, owner = acct)
    
    # determine borrowing parameter
    withdrawAmount = 10e18 #i want to borrow 10 USD
    # compute the required collateral. params: address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan 
    collateralTokenSent = sovryn.getRequiredCollateral(underlyingTokenAddress,collateralTokenAddress,withdrawAmount,50e18, True)
    print("collateral needed", collateralTokenSent)
    durationInSeconds = 60*60*24*10 #10 days
    
    #check requirements
    totalSupply = loanToken.totalSupply()
    totalBorrowed = loanToken.totalAssetBorrow()
    print('available supply:', totalSupply - totalBorrowed)
    assert(totalSupply - totalBorrowed >= withdrawAmount)
    interestRate = loanToken.nextBorrowInterestRate(withdrawAmount)
    print('interest rate (needs to be > 0):', interestRate)
    assert(interestRate > 0)
    
    
    #approve the transfer of the collateral if needed
    if(testToken.allowance(acct, loanToken.address) < collateralTokenSent):
        testToken.approve(loanToken.address, collateralTokenSent)
    
    # borrow some funds
    tx = loanToken.borrow(
        "0",                            # bytes32 loanId
        withdrawAmount,                 # uint256 withdrawAmount
        durationInSeconds,              # uint256 initialLoanDuration
        collateralTokenSent,            # uint256 collateralTokenSent
        testToken.address,                   # address collateralTokenAddress
        acct,                    # address borrower
        acct,                    # address receiver
        b''                             # bytes memory loanDataBytes
    )
    
    #assert the trade was processed as expected
    print(tx.info())
    
def setupTorqueLoanParams(loanTokenAddress, underlyingTokenAddress, collateralTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    setup = [
        b"0x0", ## id
        False, ## active
        str(acct), ## owner
        underlyingTokenAddress, ## loanToken
        collateralTokenAddress, ## collateralToken. 
        Wei("50 ether"), ## minInitialMargin
        Wei("15 ether"), ## maintenanceMargin
        0 ## fixedLoanTerm 
    ]
    params.append(setup)
    tx = loanToken.setupLoanParams(params, True)
    assert('LoanParamsSetup' in tx.events)
    assert('LoanParamsIdSetup' in tx.events)
    print(tx.info())
    
def rollover(loanId):
    sovryn = Contract.from_abi("sovryn", address=contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=acct)
    tx = sovryn.rollover(loanId, b'')
    print(tx.info())
    
def replaceLoanClosings():
    sovryn = Contract.from_abi("sovryn", address=contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=acct)
    data = sovryn.replaceContract.encode_input(loanClosingsBase.address)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(sovryn.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId);
    data = sovryn.replaceContract.encode_input(loanClosingsWith.address)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(sovryn.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId);
    
def transferOwner(contractAddress, newOwner):
    contract = Contract.from_abi("loanToken", address=contractAddress, abi=LoanToken.abi, owner=acct)
    tx= contract.transferOwnership(newOwner)
    tx.info()
    checkOwnerIsAddress(contractAddress, newOwner)

def acceptOwnershipWithMultisig(contractAddress):
    abiFile =  open('./scripts/contractInteraction/Owned.json')
    abi = json.load(abiFile)
    ownedContract = Contract.from_abi("Owned", address=contractAddress, abi=abi, owner=acct)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    data=ownedContract.acceptOwnership.encode_input()
    tx= multisig.submitTransaction(contractAddress,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print("txid",txId);
    
def getBalance(contractAddress, acct):
    contract = Contract.from_abi("Token", address=contractAddress, abi=LoanToken.abi, owner=acct)
    print(contract.balanceOf(acct))
    
def buyWRBTC():
    contract = Contract.from_abi("WRBTC", address=contracts["WRBTC"], abi=WRBTC.abi, owner=acct)
    tx = contract.deposit({'value':1e18})
    tx.info()
    print("new balance", getBalance(contracts["WRBTC"], acct))
    
def mintEarlyAccessTokens(contractAddress, userAddress):
    contract = Contract.from_abi("EarlyAccessToken", address=contractAddress, abi=EarlyAccessToken.abi, owner=acct)
    tx = contract.mint(userAddress)
    tx.info()
    
def setTransactionLimits(loanTokenAddress, addresses, limits):
    localLoanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    tx = localLoanToken.setTransactionLimits(addresses,limits)

def setTransactionLimitsOld(loanTokenAddress, settingsAddress, logicAddress, addresses, limits):
    localLoanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    localLoanToken.setTarget(settingsAddress)
    localLoanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenSettingsLowerAdmin.abi, owner=acct)
    tx = localLoanToken.setTransactionLimits(addresses,limits)
    localLoanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    localLoanToken.setTarget(logicAddress)
    

def readTransactionLimits(loanTokenAddress, SUSD, RBTC):
    localLoanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    limit = localLoanToken.transactionLimit(RBTC)
    print("RBTC limit, ",limit)
    limit = localLoanToken.transactionLimit(SUSD)
    print("USD limit, ",limit)
    
def readLiquidity():
    loanToken = Contract.from_abi("loanToken", address=contracts['iRBTC'], abi=LoanTokenLogicStandard.abi, owner=acct)
    tasRBTC = loanToken.totalAssetSupply()
    tabRBTC = loanToken.totalAssetBorrow()
    print("liquidity on iRBTC", (tasRBTC-tabRBTC)/1e18)
    
    loanToken = Contract.from_abi("loanToken", address=contracts['iDOC'], abi=LoanTokenLogicStandard.abi, owner=acct)
    tasIUSD = loanToken.totalAssetSupply()
    tabIUSD = loanToken.totalAssetBorrow()
    print("liquidity on iDOC", (tasIUSD-tabIUSD)/1e18)
    
    loanToken = Contract.from_abi("loanToken", address=contracts['iUSDT'], abi=LoanTokenLogicStandard.abi, owner=acct)
    tasIUSD = loanToken.totalAssetSupply()
    tabIUSD = loanToken.totalAssetBorrow()
    print("liquidity on iUSDT", (tasIUSD-tabIUSD)/1e18)

    tokenContract = Contract.from_abi("Token", address=contracts['USDT'], abi=TestToken.abi, owner=acct)
    bal = tokenContract.balanceOf(contracts['ConverterUSDT'])
    print("supply of USDT on swap", bal/1e18)
    
    tokenContract = Contract.from_abi("Token", address=contracts['WRBTC'], abi=TestToken.abi, owner=acct)
    bal = tokenContract.balanceOf(contracts['ConverterUSDT'])
    print("supply of rBTC on swap", bal/1e18)
    

def hasApproval(tokenContractAddr, sender, receiver):
    tokenContract = Contract.from_abi("Token", address=tokenContractAddr, abi=TestToken.abi, owner=sender)
    allowance = tokenContract.allowance(sender, receiver)
    print("allowance: ", allowance/1e18)
    
def checkIfUserHasToken(EAT, user):
    tokenContract = Contract.from_abi("Token", address=EAT, abi=TestToken.abi, owner=user)
    balance = tokenContract.balanceOf(user)
    print("balance: ", balance)
    
def readLendingBalanceForUser(loanTokenAddress, userAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=userAddress)
    bal = loanToken.balanceOf(userAddress)
    print('iToken balance', bal)
    bal = loanToken.assetBalanceOf(userAddress)
    print('underlying token balance', bal)
    
def replaceLoanTokenLogic(loanTokenAddress, logicAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    loanToken.setTarget(logicAddress)
    
def readOwner(contractAddress):
    contract = Contract.from_abi("loanToken", address=contractAddress, abi=LoanToken.abi, owner=acct)
    print('owner:',contract.owner())

def checkOwnerIsAddress(contractAddress, expectedOwner):
    contract = Contract.from_abi("loanToken", address=contractAddress, abi=LoanToken.abi, owner=acct)
    owner = contract.owner()
    print("owner == expectedOwner?", owner == expectedOwner)

def setupMarginLoanParams(collateralTokenAddress, loanTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    
    params = [];
    setup = [
        b"0x0", ## id
        False, ## active
        acct, ## owner
        "0x0000000000000000000000000000000000000000", ## loanToken -> will be overwritten
        collateralTokenAddress, ## collateralToken.
        Wei("20 ether"), ## minInitialMargin
        Wei("15 ether"), ## maintenanceMargin
        0 ## fixedLoanTerm -> will be overwritten
    ]
    params.append(setup)
    tx = loanToken.setupLoanParams(params, False)
    print(tx.info())

def swapTokens(amount, minReturn, swapNetworkAddress, sourceTokenAddress, destTokenAddress):
    abiFile =  open('./scripts/contractInteraction/SovrynSwapNetwork.json')
    abi = json.load(abiFile)
    swapNetwork = Contract.from_abi("SovrynSwapNetwork", address=swapNetworkAddress, abi=abi, owner=acct)
    sourceToken = Contract.from_abi("Token", address=sourceTokenAddress, abi=TestToken.abi, owner=acct)
    if(sourceToken.allowance(acct, swapNetworkAddress) < amount):
        sourceToken.approve(swapNetworkAddress,amount)
    path = swapNetwork.conversionPath(sourceTokenAddress,destTokenAddress)
    print("path", path)
    expectedReturn = swapNetwork.getReturnByPath(path, amount)
    print("expected return ", expectedReturn)
    '''
    tx = swapNetwork.convertByPath(
        path,
        amount,
        minReturn,
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        0
    )
    tx.info()
    '''

def replaceLoanTokenLogic(loanTokenAddress, logicAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    loanToken.setTarget(logicAddress)
    
def readFromMedianizer():
    medianizer = Contract.from_abi("Medianizer", address=contracts['medianizer'], abi=PriceFeedsMoCMockup.abi, owner=acct)
    print(medianizer.peek())

def updateOracleAddress(newAddress):
    print("set oracle address to", newAddress)
    priceFeedsMoC = Contract.from_abi("PriceFeedsMoC", address = '0x066ba9453e230a260c2a753d9935d91187178C29', abi = PriceFeedsMoC.abi, owner = acct)
    priceFeedsMoC.setMoCOracleAddress(newAddress)

    
def addLiquidity(converter, reserve, amount):
    abiFile =  open('./scripts/contractInteraction/LiquidityPoolV2Converter.json')
    abi = json.load(abiFile)
    converter = Contract.from_abi("LiquidityPoolV2Converter", address=converter, abi=abi, owner=acct)
    print("is active? ", converter.isActive())
    print("price oracle", converter.priceOracle())
    tx = converter.addLiquidity(reserve, amount, 1)
    print(tx)

def deployMultisig(owners, requiredConf):
     multisig = acct.deploy(MultiSigWallet, owners, requiredConf)
     print("multisig:", multisig)

def setupLoanParamsForCollaterals(loanTokenAddress, collateralAddresses):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicStandard.abi, owner=acct)
    marginParams = []
    torqueParams = []
    for collateralAddress in collateralAddresses:
        marginData = [
            b"0x0", ## id
            False, ## active
            str(acct), ## owner
            "0x0000000000000000000000000000000000000000", ## loanToken -> will be overwritten
            collateralAddress, ## collateralToken.
            Wei("20 ether"), ## minInitialMargin -> 20% (allows up to 5x leverage)
            Wei("15 ether"), ## maintenanceMargin -> 15%, below liquidation
            0 ## fixedLoanTerm -> will be overwritten with 28 days
        ]
        torqueData = copy.deepcopy(marginData)
        torqueData[5] = Wei("50 ether")
        print(torqueData)

        marginParams.append(marginData)
        torqueParams.append(torqueData)

    #configure the token settings, and set the setting contract address at the loan token logic contract
    tx = loanToken.setupLoanParams(marginParams, False)
    tx = loanToken.setupLoanParams(torqueParams, True)


def updatePriceFeedToRSKOracle():
    newPriceFeed = acct.deploy(PriceFeedRSKOracle, contracts['RSKOracle'])
    print("new price feed: ", newPriceFeed)
    feeds = Contract.from_abi("PriceFeeds", address= contracts['PriceFeeds'], abi = PriceFeeds.abi, owner = acct)
    feeds.setPriceFeed([contracts['WRBTC']], [newPriceFeed.address])

def updatePriceFeedToMOCOracle():
    newPriceFeed = acct.deploy(PriceFeedsMoC, contracts['medianizer'], contracts['RSKOracle'])
    print("new price feed: ", newPriceFeed)
    feeds = Contract.from_abi("PriceFeeds", address= contracts['PriceFeeds'], abi = PriceFeeds.abi, owner = acct)
    data = feeds.setPriceFeed.encode_input([contracts['WRBTC']], [newPriceFeed.address])
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(feeds.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print("txid",txId);


def readPrice(source, destination):
    feeds = Contract.from_abi("PriceFeeds", address= contracts['PriceFeeds'], abi = PriceFeeds.abi, owner = acct)
    rate = feeds.queryRate(source, destination)
    print('rate is ', rate)

def readSwapRate(source, destination):
    abiFile =  open('./scripts/contractInteraction/SovrynSwapNetwork.json')
    abi = json.load(abiFile)
    swapNetwork = Contract.from_abi("SovrynSwapNetwork", address=contracts['swapNetwork'], abi=abi, owner=acct)
    path = swapNetwork.conversionPath(source,destination)
    #print("path:", path)
    expectedReturn = swapNetwork.getReturnByPath(path, 0.01e18)
    print('rate is ', expectedReturn)

def readPriceFromOracle(oracleAddress):
    oracle = Contract.from_abi("Oracle", address=oracleAddress, abi=PriceFeedsMoC.abi, owner=acct)
    price = oracle.latestAnswer()
    print('rate is ', price)

def readTargetWeights(converter, reserve):
    abiFile =  open('./scripts/contractInteraction/LiquidityPoolV2Converter.json')
    abi = json.load(abiFile)
    converter = Contract.from_abi("LiquidityPoolV2Converter", address=converter, abi=abi, owner=acct)
    res = converter.reserves(reserve).dict()
    print(res)
    print('target weight is ',res['weight'])

def updateContracts():
    replaceSwapsImplSovrynSwap()
    replaceSwapsUser()
    replaceLoanOpenings()
    replaceLoanTokenLogicOnAllContracts()

def replaceSwapsExternal():
    #swapsExternal = acct.deploy(SwapsExternal)
    sovryn = Contract.from_abi("sovryn", address=contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=acct)
    data = sovryn.replaceContract.encode_input('0xAa1dEDE8C097349Dd25C98A0bF79c8D9B6e55caf')
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(sovryn.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId);

def replaceLoanOpenings():
    print("replacing loan openings")
    loanOpenings = acct.deploy(LoanOpenings)
    sovryn = Contract.from_abi("sovryn", address=contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=acct)
    data = sovryn.replaceContract.encode_input(loanOpenings.address)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(sovryn.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId);

def replaceSwapsUser():
    print("replacing swaps user")
    swapsUser = acct.deploy(SwapsUser)
    sovryn = Contract.from_abi("sovryn", address=contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=acct)
    data = sovryn.replaceContract.encode_input(swapsUser.address)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(sovryn.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId);

def replaceSwapsImplSovrynSwap():
    print("replacing swaps")
    swaps = acct.deploy(SwapsImplSovrynSwap)
    sovryn = Contract.from_abi("sovryn", address=contracts['sovrynProtocol'], abi=interface.ISovrynBrownie.abi, owner=acct)
    data = sovryn.setSwapsImplContract.encode_input(swaps.address)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(sovryn.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId);

def replaceLoanTokenLogicOnAllContracts():
    print("replacing loan token logic")
    #logicContract = acct.deploy(LoanTokenLogicStandard)
    #print('new LoanTokenLogicStandard contract for iDoC:' + logicContract.address)
    #replaceLoanTokenLogic(contracts['iDOC'],logicContract.address)
    replaceLoanTokenLogic(contracts['iUSDT'],'0xFeEe82AF436cf937990f9A1087bb6c1106F35751')
    replaceLoanTokenLogic(contracts['iBPro'],'0xFeEe82AF436cf937990f9A1087bb6c1106F35751')
    logicContract = acct.deploy(LoanTokenLogicWrbtc)
    print('new LoanTokenLogicStandard contract for iWRBTC:' + logicContract.address)
    replaceLoanTokenLogic(contracts['iRBTC'], logicContract.address)

def replaceLoanTokenLogic(loanTokenAddress, logicAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    data = loanToken.setTarget.encode_input(logicAddress)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(loanToken.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId)

def checkRates():
    print('reading price from WRBTC to DOC')
    readPrice(contracts['WRBTC'], contracts['DoC'])
    print('reading price from WRBTC to USDT')
    readPrice(contracts['WRBTC'], contracts['USDT'])
    print('reading price from WRBTC to BPRO')
    readPrice(contracts['WRBTC'], contracts['BPro'])
    print('read price from USDT to DOC')
    readPrice(contracts['USDT'], contracts['DoC'])

    print('read swap rate from WRBTC to DOC')
    readSwapRate(contracts['WRBTC'], contracts['DoC'])
    print('read swap rate from WRBTC to USDT')
    readSwapRate(contracts['WRBTC'], contracts['USDT'])
    print('read swap rate from WRBTC to BPRO')
    readSwapRate(contracts['WRBTC'], contracts['BPro'])
    print('read swap rate from USDT to DOC')
    readSwapRate(contracts['USDT'], contracts['DoC'])
    print('read swap rate from BPro to DOC')
    readSwapRate(contracts['BPro'], contracts['DoC'])
    print('read swap rate from BPro to USDT')
    readSwapRate(contracts['BPro'], contracts['USDT'])
    print('read swap rate from USDT to WRBTC')
    readSwapRate(contracts['USDT'], contracts['WRBTC'])
    print('read swap rate from DOC to WRBTC')
    readSwapRate(contracts['DoC'], contracts['WRBTC'])

    print("price from the USDT oracle on AMM:")
    readPriceFromOracle('0x78F0b35Edd78eD564830c45F4A22e4b553d7f042')

    readTargetWeights('0x133eBE9c8bA524C9B1B601E794dF527f390729bF', contracts['USDT'])
    readTargetWeights('0x133eBE9c8bA524C9B1B601E794dF527f390729bF', contracts['WRBTC'])

def addOwnerToMultisig(newOwner):
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    data = multisig.addOwner.encode_input(newOwner)
    tx = multisig.submitTransaction(multisig.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print("txid",txId);


def governorAcceptAdmin(type):
    governor = Contract.from_abi("GovernorAlpha", address=contracts[type], abi=GovernorAlpha.abi, owner=acct)
    data = governor.__acceptAdmin.encode_input()

    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(governor.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId)

def setEarlyAccessToken(loanTokenAddress, EATokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanToken.abi, owner=acct)
    data = loanToken.setEarlyAccessToken.encode_input(EATokenAddress)
    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    tx = multisig.submitTransaction(loanToken.address,0,data)
    txId = tx.events["Submission"]["transactionId"]
    print(txId);

def createProposalSIP005():
    dummyAddress = contracts['GovernorOwner']
    dummyContract = Contract.from_abi("DummyContract", address=dummyAddress, abi=DummyContract.abi, owner=acct)

    # action
    target = contracts['VestingRegistry']
    signature = "approveTokens(address,address,address)"
    data = dummyContract.approveTokens.encode_input(contracts['CSOV1'], contracts['CSOV2'], contracts['SOV'])
    data = "0x" + data[10:]
    description = "SIP-0005: Redeeming cSOV for SOV. Details:  , sha256: "

    governor = Contract.from_abi("GovernorAlpha", address=contracts['GovernorOwner'], abi=GovernorAlpha.abi, owner=acct)
    print(governor.address)

    print([target])
    print([0])
    print([signature])
    print([data])
    print(description)

    # # create proposal
    # governor.propose(
    #     [target],
    #     [0],
    #     [signature],
    #     [data],
    #     description)
