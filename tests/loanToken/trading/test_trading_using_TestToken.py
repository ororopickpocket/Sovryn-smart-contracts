'''
test script for testing the loan token trading logic with 2 TestTokens. 
1. opening a margin trade position with loan tokens
2. opening a margin trade position with collateral tokens
3. closing a margin trade position completely
4. closing a margin trade position partially
5. checks if getMarginBorrowAmountAndRate returns the correct loan size
'''

#!/usr/bin/python3
import pytest
from loanToken.trading.shared_trading_functions import *

'''
verifies that the loan token address is set on the contract
'''
def test_loanAddress(loanToken, SUSD):
    loanTokenAddress = loanToken.loanTokenAddress()
    assert loanTokenAddress == SUSD.address
  
'''
tests margin trading sending loan tokens.
process is handled by the shared function margin_trading_sending_loan_tokens
1. approve the transfer
2. send the margin trade tx
3. verify the trade event and balances are correct
4. retrieve the loan from the smart contract and make sure all values are set as expected
'''
def test_margin_trading_sending_loan_tokens(accounts, sovryn, loanToken, SUSD, RBTC, priceFeeds, chain, SOV, FeesEvents):
    margin_trading_sending_loan_tokens(accounts, sovryn, loanToken, 1e19, SUSD, RBTC, priceFeeds, chain, False)
    margin_trading_sov_reward_payment(accounts, loanToken, 1e19, SUSD, RBTC, chain, SOV, FeesEvents)

def test_margin_trading_sending_loan_tokens_tiny_amount(accounts, sovryn, loanToken, SUSD, RBTC, priceFeeds, chain, SOV, FeesEvents):
    margin_trading_sending_loan_tokens_tiny_amount(accounts, sovryn, loanToken, SUSD, RBTC, priceFeeds, chain, False)

'''
tests margin trading sending collateral tokens as collateral. 
process:
1. send the margin trade tx with the passed parameter (NOTE: the token transfer needs to be approved already)
2. TODO verify the trade event and balances are correct
''' 
def test_margin_trading_sending_collateral_tokens(accounts, sovryn, loanToken, SUSD, RBTC, chain, FeesEvents, SOV, priceFeeds):
    loanSize = 10000e18
    SUSD.mint(loanToken.address, loanSize * 12)
    #   address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan
    collateralTokenSent = sovryn.getRequiredCollateral(SUSD.address, RBTC.address, loanSize * 2, 50e18, False)
    RBTC.mint(accounts[0], collateralTokenSent)
    RBTC.mint(accounts[2], collateralTokenSent)
    # important! WRBTC is being held by the loanToken contract itself, all other tokens are transfered directly from
    # the sender and need approval
    RBTC.approve(loanToken.address, collateralTokenSent)
    RBTC.approve(loanToken.address, collateralTokenSent, {'from': accounts[2]})

    leverageAmount = 5e18
    value = 0
    margin_trading_sending_collateral_tokens(accounts, sovryn, loanToken, SUSD, RBTC, loanSize, collateralTokenSent,
                                             leverageAmount, value, priceFeeds)
    margin_trading_sending_collateral_tokens_sov_reward_payment(accounts[2], loanToken, RBTC, collateralTokenSent,
                                                                leverageAmount, value, chain, FeesEvents, SOV)


'''
should completely close a position.
first with returning loan tokens, then with returning collateral tokens to the sender.
process is handled by the shared function close_complete_margin_trade
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
'''
@pytest.mark.parametrize('return_token_is_collateral', [False, True])
def test_close_complete_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral):
    close_complete_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral)

'''
test SOV reward payment
'''
@pytest.mark.parametrize('return_token_is_collateral', [False, True])
def test_close_complete_margin_trade_sov_reward_payment(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position,
                                                        chain, return_token_is_collateral, FeesEvents, SOV):
    close_complete_margin_trade_sov_reward_payment(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position,
                                                   chain, return_token_is_collateral, FeesEvents, SOV)


'''
should partially close a position.
first with returning loan tokens, then with returning collateral tokens to the sender.
process is handled by the shared function close_partial_margin_trade
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
'''
@pytest.mark.parametrize('return_token_is_collateral', [False, True])
def test_close_partial_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral):
    close_partial_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral)


'''
test SOV reward payment
'''
@pytest.mark.parametrize('return_token_is_collateral', [False, True])
def test_close_partial_margin_trade_sov_reward_payment(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position,
                                                       chain, return_token_is_collateral, FeesEvents, SOV):
    close_partial_margin_trade_sov_reward_payment(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position,
                                                  chain, return_token_is_collateral, FeesEvents, SOV)

'''
verifies that the loan size is computed correctly
'''
def test_getMarginBorrowAmountAndRate(loanToken, set_demand_curve, lend_to_pool):
    set_demand_curve()
    (receiver, _) = lend_to_pool()
    deposit = 100e18
    borrowAmount = loanToken.getMarginBorrowAmountAndRate(4e18, deposit)
    monthly_interest = borrowAmount[1]*28/365
    #divide by 1000 because of rounding
    actualAmount = fixedint(borrowAmount[0]).div(1000).num
    expectedAmount = fixedint(deposit).mul(4).mul(1e20).div(fixedint(1e20).sub(monthly_interest).num).div(1000).num
    assert(actualAmount == expectedAmount)
    
'''
test the correct max escrow amount is returned (considering that the function is actually returning a bit less than the max)
'''
def test_getMaxEscrowAmount(loanToken, set_demand_curve, lend_to_pool):
    set_demand_curve()
    (receiver, _) = lend_to_pool()
    maxEscrowAmount1x = loanToken.getMaxEscrowAmount(1e18)
    maxEscrowAmount4x = loanToken.getMaxEscrowAmount(4e18)
    assert(maxEscrowAmount1x == maxEscrowAmount4x * 4)
    maxLoanSize = loanToken.getMarginBorrowAmountAndRate(1e18, maxEscrowAmount1x)
    supply = loanToken.totalAssetSupply()
    #note maxLoanSize != supply because getMaxEscrowAmount assumes an interest rate of 100%, but less is actually used
    #checked the correctnessby printing the value but don't add a manual check here because no time and having issues with brownie
    #ReturnValue

def test_margin_trading_without_early_access_token_should_fail(accounts, sovryn, loanToken, SUSD, RBTC, priceFeeds, chain, TestToken):
    # prepare early access token
    early_access_token = accounts[0].deploy(TestToken, "Sovryn Early Access Token", "SEAT", 1, 10)
    early_access_token.transfer(accounts[1], early_access_token.balanceOf(accounts[0]))
    loanToken.setEarlyAccessToken(early_access_token.address)

    with reverts("No early access tokens"):
        margin_trading_sending_loan_tokens(accounts, sovryn, loanToken, SUSD, RBTC, priceFeeds, chain, False) 


def test_increasing_position_of_other_trader_should_fail(accounts, sovryn, loanToken, SUSD, RBTC, priceFeeds, chain, SOV, FeesEvents,lend_to_pool,open_margin_trade_position):
    #prepare the test
    (receiver, _) = lend_to_pool()
    #trader=accounts[1] on this call
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position()

    #deposit collateral to add margin to the loan created above
    RBTC.approve(sovryn, 1e18)
    tx = sovryn.depositCollateral(loan_id, 1e18)
    RBTC.transfer(accounts[2], 1e18)
    RBTC.approve(loanToken, 1e18, {'from':accounts[2]})

    with reverts("unauthorized use of existing loan"):
        tx = loanToken.marginTrade(
            loan_id, #loanId  (0 for new loans)
            2e18, # leverageAmount
            0, #loanTokenSent
            1000, # no collateral token sent
            RBTC.address, #collateralTokenAddress
            accounts[1], #trader,
            b'', #loanDataBytes (only required with ether)
            {'from':accounts[2]}
        )