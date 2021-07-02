import pytest
from brownie import Contract, Wei, reverts
from fixedint import *
from loanToken.trading.shared_trading_functions import *
import shared

def test_swapExternal(accounts, sovryn, RBTC, SUSD):
    SUSD.approve(sovryn.address, 1e18) 

    tx = sovryn.swapExternal(SUSD.address, RBTC.address, accounts[0], accounts[0], 1e18, 0, 0, b'')
    
    external_swap = tx.events['ExternalSwap']
    assert(external_swap['user'] == accounts[0])
    assert(external_swap['sourceToken'] == SUSD.address)
    assert(external_swap['destToken'] == RBTC.address)
    destTokenAmount = sovryn.getSwapExpectedReturn(SUSD.address, RBTC.address, 1e18)
    tradingFee = destTokenAmount * sovryn.tradingFeePercent() / 1e20
    desTokenAmountAfterFee = destTokenAmount - tradingFee
    assert(tx.return_value[0] == desTokenAmountAfterFee)
    assert(tx.return_value[1] == 1e18)
    assert(external_swap['sourceAmount'] == tx.return_value[1])
    assert(external_swap['destAmount'] == tx.return_value[0])


'''
    Should fail with zero sourceTokenAmount
'''
def test_swapExternal_with_zero_sourceTokenAmount(accounts, sovryn, RBTC, SUSD):
    SUSD.approve(sovryn.address, 1e18)
    with reverts("sourceTokenAmount == 0"):
        sovryn.swapExternal(SUSD.address, RBTC.address, accounts[0], accounts[0], 0, 0, 0, b'')


'''
    Should fail without enough allowance
'''
def test_swapExternal_without_enough_allowance(accounts, sovryn, RBTC, SUSD):
    SUSD.approve(sovryn.address, 1e17)
    with reverts("SafeERC20: low-level call failed"):
        sovryn.swapExternal(SUSD.address, RBTC.address, accounts[0], accounts[0], 1e18, 0, 0, b'')


'''
    Should fail with larger minReturn than destTokenAmountReceived
'''
def test_swapExternal_with_larger_minReturn(accounts, sovryn, RBTC, SUSD):
    SUSD.approve(sovryn.address, 1e18)
    with reverts("destTokenAmountReceived too low"):
        sovryn.swapExternal(SUSD.address, RBTC.address, accounts[0], accounts[0], 1e18, 0, 1e18, b'')


def test_getSwapExpectedReturn(accounts, sovryn, RBTC, SUSD):
    result = sovryn.getSwapExpectedReturn(SUSD.address, RBTC.address, 1e18)
    assert(result == 1e14)


def test_margin_trading_sending_collateral_tokens_with_smaller_rate(accounts, sovryn, loanToken, SUSD, WRBTC, chain, FeesEvents, SOV, priceFeeds):
    priceFeeds.setRates(WRBTC.address, SUSD.address, 1e18)

    loanSize = 10000e18
    SUSD.mint(loanToken.address, loanSize*12)
    collateralTokenSent = sovryn.getRequiredCollateral(SUSD.address, WRBTC.address, loanSize*2, 50e18, False)
    leverageAmount = 5e18

    minReturn = (leverageAmount + 1) * collateralTokenSent * 0.98 / 1e18
    
    print("minReturn",minReturn)
    print("collateralTokenSent",collateralTokenSent/1e18)

    with reverts("swap too large"):
        loanToken.marginTrade(
            "0", #loanId  (0 for new loans)
            leverageAmount, # leverageAmount
            0, #loanTokenSent
            collateralTokenSent, 
            WRBTC.address, #collateralTokenAddress
            accounts[0], #trader, 
            minReturn,  # minReturn
            b'', #loanDataBytes (only required with ether),
            {'value' : collateralTokenSent}
        )


'''
    Should succeed with larger rate than maxSlippage in positive direction
'''
def test_check_price_disagreement_with_larger_rate(accounts, sovryn, loanToken, SUSD, WRBTC, chain, FeesEvents, SOV, priceFeeds):
        rate = priceFeeds.checkPriceDisagreement(WRBTC.address, SUSD.address, 1e18, 2e22, 0)
        assert(rate == 2e22)


'''
    Should fail with larger rate than maxSlippage in negative direction
'''
def test_check_price_disagreement_with_larger_rate(accounts, sovryn, loanToken, SUSD, WRBTC, chain, FeesEvents, SOV, priceFeeds):
        with reverts("price disagreement"):
            priceFeeds.checkPriceDisagreement(WRBTC.address, SUSD.address, 1e18, 1e18, 0)
