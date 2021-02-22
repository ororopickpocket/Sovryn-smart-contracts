'''
tests loan opening isolated. does not work together with the other tests. needs to be run separately.
'''

#!/usr/bin/python3

import pytest
from brownie import Contract, Wei, reverts
from fixedint import *


@pytest.fixture(scope="module", autouse=True)
def loanClosingsWith(LoanClosingsWith, accounts, sovryn, Constants, priceFeeds, swapsImpl):
    sovryn.replaceContract(accounts[0].deploy(LoanClosingsWith).address)

@pytest.fixture(scope="module", autouse=True)
def affiliates(Affiliates, accounts, sovryn, Constants, priceFeeds, swapsImpl):
    sovryn.replaceContract(accounts[0].deploy(Affiliates).address)

@pytest.fixture(scope="module")
def LinkDaiMarginParamsId(Constants, RBTC, SUSD, sovryn, accounts):

    loanParams = {
        "id": "0x0",
        "active": False,
        "owner": Constants["ZERO_ADDRESS"],
        "loanToken": SUSD.address,
        "collateralToken": RBTC.address,
        "minInitialMargin": 20e18,
        "maintenanceMargin": 15e18,
        "fixedLoanTerm": "2419200" # 28 days
    }
    tx = sovryn.setupLoanParams([list(loanParams.values())])
    return tx.events["LoanParamsIdSetup"][0]["id"]

@pytest.fixture(scope="module")
def LinkDaiBorrowParamsId(Constants, RBTC, SUSD, sovryn, accounts):

    loanParams = {
        "id": "0x0",
        "active": False,
        "owner": Constants["ZERO_ADDRESS"],
        "loanToken": SUSD.address,
        "collateralToken": RBTC.address,
        "minInitialMargin": 20e18,
        "maintenanceMargin": 15e18,
        "fixedLoanTerm": "0" # torque loan
    }
    tx = sovryn.setupLoanParams([list(loanParams.values())])
    return tx.events["LoanParamsIdSetup"][0]["id"]

def test_marginTradeFromPool_sim(Constants, LinkDaiMarginParamsId, sovryn, SUSD, RBTC, accounts, web3):

    ## setup simulated loan pool
    sovryn.setLoanPool(
        [
            accounts[1],
        ],
        [
            accounts[2]
        ]
    )

    sovrynBeforeSUSDBalance = SUSD.balanceOf(sovryn.address)
    print("sovrynBeforeSUSDBalance", sovrynBeforeSUSDBalance)

    sovrynBeforeRBTCBalance = RBTC.balanceOf(sovryn.address)
    print("sovrynBeforeRBTCBalance", sovrynBeforeRBTCBalance)

    loanTokenSent = 100e18

    SUSD.mint(
        sovryn.address,
        loanTokenSent,
        { "from": accounts[0] }
    )
    
    sovrynSwap = sovryn.sovrynSwapContractRegistryAddress()
    #print('sovryn seap contract registry address is ',sovrynSwap)
    #addressOf = sovrynSwap.addressOf(sovrynSwap.address)
    print('returned address is ',sovrynSwap)
    swapsI = sovryn.swapsImpl()
    print('swaps impl is ', swapsI)
    collateralTokenSent = sovryn.getRequiredCollateral(
        SUSD.address,
        RBTC.address,
        loanTokenSent,
        50e18,
        False
    )
    print('required collateral:', collateralTokenSent/1e18)
    
    RBTC.mint(
        sovryn.address,
        collateralTokenSent,
        { "from": accounts[0] }
    )

    print("loanTokenSent",loanTokenSent)
    print("collateralTokenSent",collateralTokenSent)

    tx = sovryn.borrowOrTradeFromPool(
        LinkDaiMarginParamsId, #loanParamsId
        "0", # loanId
        False, # isTorqueLoan,
        100e18, # initialMargin
        [
            accounts[2], # lender
            accounts[1], # borrower
            accounts[1], # receiver
            Constants["ZERO_ADDRESS"], # manager
        ],
        [
            5e18, # newRate (5%)
            loanTokenSent, # newPrincipal
            0, # torqueInterest
            loanTokenSent, # loanTokenSent
            collateralTokenSent # collateralTokenSent
        ],
        b'', # loanDataBytes
        { "from": accounts[1] }
    )
    print(tx.events)

    sovrynAfterSUSDBalance = SUSD.balanceOf(sovryn.address)
    print("sovrynAfterSUSDBalance", sovrynAfterSUSDBalance)

    sovrynAfterRBTCBalance = RBTC.balanceOf(sovryn.address)
    print("sovrynAfterRBTCBalance", sovrynAfterRBTCBalance)

    tradeEvent = tx.events["Trade"][0]
    print(tradeEvent)

    interestForPosition = fixedint(loanTokenSent).mul(5e18).div(1e20).div(365).mul(2419200).div(86400)
    print("interestForPosition",interestForPosition)

    # expectedPositionSize = collateralTokenSent + ((loanTokenSent - interestForPosition) * tradeEvent["entryPrice"] // 1e18)
    expectedPositionSize = fixedint(loanTokenSent).sub(interestForPosition).mul(tradeEvent["entryPrice"]).div(1e18).add(collateralTokenSent)

    ## ignore differences in least significant digits due to rounding error
    assert abs(expectedPositionSize.num - int(tradeEvent["positionSize"])) < 100
    
    '''l = sovryn.getUserLoans(
        accounts[1],
        0,
        100,
        0,
        False,
        False)
    print (l)'''

    '''
    trace = web3.provider.make_request(
        "debug_traceTransaction", (tx.txid, {"disableMemory": True, "disableStack": True, "disableStorage": False})
    )
    trace = trace["result"]["structLogs"]
    for i in reversed(trace):
        if i["depth"] == 1:
            import pprint
            storage = pprint.pformat(i["storage"], indent=2, width=80)
            f = open("latest_storage.log", "w")
            f.write(storage)
            f.close()
            break
    '''

    #assert(False)

def test_borrowFromPool_sim(Constants, LinkDaiBorrowParamsId, sovryn, SUSD, RBTC, accounts, web3):

    ## setup simulated loan pool
    sovryn.setLoanPool(
        [
            accounts[1],
        ],
        [
            accounts[2]
        ]
    )

    sovrynBeforeSUSDBalance = SUSD.balanceOf(sovryn.address)
    print("sovrynBeforeSUSDBalance", sovrynBeforeSUSDBalance)

    sovrynBeforeRBTCBalance = RBTC.balanceOf(sovryn.address)
    print("sovrynBeforeRBTCBalance", sovrynBeforeRBTCBalance)

    ## loanTokenSent to protocol is just the borrowed/escrowed interest since the actual borrow would have
    ## already been transfered to the borrower by the pool before borrowOrTradeFromPool is called
    loanTokenSent = 1e18
    newPrincipal = 101e18

    SUSD.mint(
        sovryn.address,
        loanTokenSent,
        { "from": accounts[0] }
    )

    collateralTokenSent = sovryn.getRequiredCollateral(
        SUSD.address,
        RBTC.address,
        newPrincipal,
        50e18,
        True
    )
    
    
    RBTC.mint(
        sovryn.address,
        collateralTokenSent,
        { "from": accounts[0] }
    )

    print("newPrincipal",newPrincipal)
    print("loanTokenSent",loanTokenSent)
    print("collateralTokenSent",collateralTokenSent)

    tx = sovryn.borrowOrTradeFromPool(
        LinkDaiBorrowParamsId, #loanParamsId
        "0", # loanId
        True, # isTorqueLoan,
        50e18, # initialMargin
        [
            accounts[2], # lender
            accounts[1], # borrower
            accounts[1], # receiver
            Constants["ZERO_ADDRESS"], # manager
        ],
        [
            5e18, # newRate (5%)
            newPrincipal, # newPrincipal
            1e18, # torqueInterest
            loanTokenSent, # loanTokenSent
            collateralTokenSent # collateralTokenSent
        ],
        b'', # loanDataBytes
        { "from": accounts[1] }
    )
    print(tx.events)

    sovrynAfterSUSDBalance = SUSD.balanceOf(sovryn.address)
    print("sovrynAfterSUSDBalance", sovrynAfterSUSDBalance)

    sovrynAfterRBTCBalance = RBTC.balanceOf(sovryn.address)
    print("sovrynAfterRBTCBalance", sovrynAfterRBTCBalance)

    borrowEvent = tx.events["Borrow"][0]
    print(borrowEvent)
    

    '''l = sovryn.getUserLoans(
        accounts[1],
        0,
        100,
        0,
        False,
        False)
    print (l)'''

    '''
    trace = web3.provider.make_request(
        "debug_traceTransaction", (tx.txid, {"disableMemory": True, "disableStack": True, "disableStorage": False})
    )
    trace = trace["result"]["structLogs"]
    for i in reversed(trace):
        if i["depth"] == 1:
            import pprint
            storage = pprint.pformat(i["storage"], indent=2, width=80)
            f = open("latest_storage.log", "w")
            f.write(storage)
            f.close()
            break
    '''

    #assert(False)
