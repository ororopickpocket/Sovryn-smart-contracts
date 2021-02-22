#!/usr/bin/python3

import pytest
from brownie import Contract, network
from brownie.network.contract import InterfaceContainer
from brownie.network.state import _add_contract, _remove_contract
from fixtures_loan_token import *

@pytest.fixture(scope="module")
def Constants():
    return {
        "ZERO_ADDRESS": "0x0000000000000000000000000000000000000000",
        "ONE_ADDRESS": "0x0000000000000000000000000000000000000001",
        "MAX_UINT": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    }

@pytest.fixture(scope="module")
def SUSD(accounts, TestToken):
    return accounts[0].deploy(TestToken, "SUSD", "SUSD", 18, 1e50)

@pytest.fixture(scope="module")
def RBTC(accounts, TestToken):
    return accounts[0].deploy(TestToken, "RBTC", "RBTC", 18, 1e50)

@pytest.fixture(scope="module")
def priceFeeds(accounts, WRBTC, SUSD, RBTC, BZRX, PriceFeeds, PriceFeedsLocal):
    if network.show_active() == "development":
        feeds = accounts[0].deploy(PriceFeedsLocal, WRBTC.address, BZRX.address)
        
        feeds.setRates(
            WRBTC.address,
            RBTC.address,
            1e18
        )
        feeds.setRates(
            WRBTC.address,
            SUSD.address,
            1e22
        )
        feeds.setRates(
            RBTC.address,
            SUSD.address,
            1e22
        )
    else:
        feeds = accounts[0].deploy(PriceFeeds, WRBTC.address, BZRX.address)
        #feeds.setPriceFeedsBatch(...)

    return feeds

@pytest.fixture(scope="module")
def swapsImpl(accounts, SwapsImplSovrynSwap, SwapsImplLocal):
    '''
    if network.show_active() == "development":
        swap = accounts[0].deploy(SwapsImplLocal)
    else:
        swap = accounts[0].deploy(SwapsImplKyber)
        #feeds.setPriceFeedsBatch(...)
    '''

    swap = accounts[0].deploy(SwapsImplSovrynSwap)

    return swap

@pytest.fixture(scope="module", autouse=True)

def sovryn(accounts, interface, sovrynProtocol, ProtocolSettings, LoanSettings, LoanMaintenance, WRBTC, SUSD, RBTC, TestSovrynSwap, priceFeeds, SwapsExternal, Affiliates):

    sovrynproxy = accounts[0].deploy(sovrynProtocol)
    sovryn = Contract.from_abi("sovryn", address=sovrynproxy.address, abi=interface.ISovrynBrownie.abi, owner=accounts[0])
    _add_contract(sovryn)

    sovryn.replaceContract(accounts[0].deploy(ProtocolSettings).address)
    sovryn.replaceContract(accounts[0].deploy(LoanSettings).address)
    sovryn.replaceContract(accounts[0].deploy(LoanMaintenance).address)
    sovryn.replaceContract(accounts[0].deploy(Affiliates).address)
    sovryn.replaceContract(accounts[0].deploy(SwapsExternal).address)
    #sovryn.replaceContract(accounts[0].deploy(LoanOpenings).address)
    #sovryn.replaceContract(accounts[0].deploy(LoanClosings).address)

    sovrynSwapSimulator = accounts[0].deploy(TestSovrynSwap, priceFeeds)
    sovryn.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address)
    sovryn.setSupportedTokens([SUSD.address,RBTC.address, WRBTC.address],[True,True, True])

    sovryn.setWrbtcToken(WRBTC.address)
    
    return sovryn

@pytest.fixture(scope="function", autouse=True)
def isolate(fn_isolation):
    pass

@pytest.fixture(scope="module", autouse=True)
def WRBTC(module_isolation, accounts, TestWrbtc):
    yield accounts[0].deploy(TestWrbtc) ## 0x3194cBDC3dbcd3E11a07892e7bA5c3394048Cc87

@pytest.fixture(scope="module", autouse=True)
def BZRX(module_isolation, accounts, TestWrbtc):
    yield accounts[0].deploy(TestWrbtc) ## 0x3194cBDC3dbcd3E11a07892e7bA5c3394048Cc87


@pytest.fixture()
def SOV(accounts, TestToken, sovryn, priceFeeds, SUSD, WRBTC):
    sov = accounts[0].deploy(TestToken, "SOV", "SOV", 18, 10**50)
    sovryn.setProtocolTokenAddress(sov.address)

    priceFeeds.setRates(
        SUSD.address,
        sov.address,
        1e18
    )

    sov.approve(sovryn.address, 1e20)
    sovryn.depositProtocolToken(1e20)

    return sov
